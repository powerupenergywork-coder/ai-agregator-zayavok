import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { normalizePhone } from "../common/phone.util";
import { env } from "../config/env";
import { BillingService } from "./billing.service";

/**
 * Коды ответа из «Протокола взаимодействия (онлайн)». Возвращаются и на
 * check, и на pay; словами их банк не читает, только числами.
 */
export const KaspiResult = {
  OK: 0,
  /** Абонента с таким идентификатором у нас нет. */
  NOT_FOUND: 1,
  /** Заказ отменён — у нас это заблокированный поставщик. */
  CANCELLED: 2,
  ALREADY_PAID: 3,
  IN_PROGRESS: 4,
  /** Всё остальное, включая нашу собственную аварию. */
  ERROR: 5,
} as const;

export interface KaspiResponse {
  txn_id: string;
  result: number;
  sum?: string;
  prv_txn_id?: string;
  comment?: string;
  fields?: Record<string, { "@name": string; "#text": string }>;
}

/**
 * Приём платежей по протоколу биллера Kaspi.
 *
 * Направление обратное привычному шлюзу: мы не создаём платёж и не отдаём
 * ссылку. Поставщик открывает Kaspi, находит нашу услугу, вводит свой номер
 * телефона и платит — а банк дёргает наш endpoint дважды, сначала check
 * («такой абонент есть? сколько с него?»), потом pay («зачисли»).
 *
 * Из этого следует всё остальное устройство:
 *
 * — Идентификатор абонента это телефон. Ничего другого поставщик о себе не
 *   знает наизусть, а вводить он будет с телефона, стоя у крана.
 *
 * — Идемпотентность обязательна и не опциональна. Протокол прямо требует:
 *   повторный txn_id должен вернуть результат предыдущей обработки. Kaspi
 *   повторяет запрос при любом обрыве, так что второй раз приходит штатно, а
 *   не в аварии. Реализовано уникальным индексом на KaspiPayment.txnId —
 *   гонку выигрывает база, а не наша проверка «а нет ли уже такого».
 *
 * — Ошибку на pay возвращаем только если действительно не можем зачислить.
 *   Деньги в этот момент уже списаны с человека; ответ «ошибка провайдера»
 *   после списания это разбирательство в поддержке, а не техническая деталь.
 */
@Injectable()
export class KaspiBillerService {
  private readonly logger = new Logger(KaspiBillerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  /**
   * Телефон, как его введёт плательщик, к нашему каноническому виду.
   *
   * Люди наберут «7071234567», «87071234567» или «+7 707 123 45 67» — все три
   * должны найти одного и того же человека. normalizePhone() уже умеет это,
   * здесь только отсекаем заведомо не-телефон, чтобы не искать в базе мусор.
   */
  private toPhone(account: string): string | null {
    const digits = account.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 11) return null;
    return normalizePhone(digits);
  }

  private async findSupplier(account: string) {
    const phone = this.toPhone(account);
    if (!phone) return null;
    return this.prisma.supplierProfile.findFirst({
      where: { user: { phone } },
      include: { user: true, subscription: true },
    });
  }

  private money(tenge: number): string {
    return tenge.toFixed(2);
  }

  /**
   * «Есть такой абонент и можно ли ему платить».
   *
   * Ничего не меняет и не записывает: check приходит и просто так, когда
   * человек листает форму оплаты. Сумму из запроса игнорируем — протокол
   * говорит прямо, что в check она фиктивная.
   *
   * В fields отдаём название компании: плательщик увидит его в приложении и
   * поймёт, что не ошибся номером. Стоит одной строки, а ошибка «оплатил не
   * тому» стоит возврата.
   */
  async check(txnId: string, account: string): Promise<KaspiResponse> {
    if (!env.kaspiBillerEnabled) {
      return { txn_id: txnId, result: KaspiResult.ERROR, comment: "Приём платежей не настроен" };
    }
    const supplier = await this.findSupplier(account);
    if (!supplier) {
      return { txn_id: txnId, result: KaspiResult.NOT_FOUND, comment: "Исполнитель с таким номером не найден" };
    }
    if (supplier.isBlocked) {
      return { txn_id: txnId, result: KaspiResult.CANCELLED, comment: "Профиль заблокирован" };
    }
    return {
      txn_id: txnId,
      result: KaspiResult.OK,
      sum: this.money(env.subscriptionPriceTenge),
      comment: "OK",
      fields: {
        field1: { "@name": "Исполнитель", "#text": supplier.companyName ?? supplier.user.phone },
      },
    };
  }

  /**
   * «Деньги внесены — зачисляй».
   *
   * Порядок намеренно такой: сначала пытаемся записать транзакцию, и только
   * если запись прошла — продлеваем подписку. Уникальный индекс на txnId
   * означает, что при повторе вставка упадёт, мы прочитаем прошлый ответ и
   * вернём его дословно, ничего не начислив второй раз.
   */
  async pay(txnId: string, account: string, sumRaw: string, txnDateRaw?: string): Promise<KaspiResponse> {
    const existing = await this.prisma.kaspiPayment.findUnique({ where: { txnId } });
    if (existing) {
      this.logger.log(`Повторный txn_id ${txnId} — отдаю прошлый результат ${existing.result}`);
      return this.replay(existing);
    }

    if (!env.kaspiBillerEnabled) {
      return { txn_id: txnId, result: KaspiResult.ERROR, comment: "Приём платежей не настроен" };
    }

    const supplier = await this.findSupplier(account);
    const sumTenge = Math.floor(Number(sumRaw));
    if (!Number.isFinite(sumTenge) || sumTenge <= 0) {
      return this.record(txnId, account, null, null, txnDateRaw, KaspiResult.ERROR, "Некорректная сумма");
    }
    if (!supplier) {
      return this.record(txnId, account, null, sumTenge, txnDateRaw, KaspiResult.NOT_FOUND, "Исполнитель не найден");
    }

    // Дней столько, за сколько заплатили. Kaspi позволяет плательщику
    // ввести произвольную сумму, и оба простых варианта плохи: отказать
    // после списания — разбирательство в поддержке, а выдать полный период
    // за половину денег — подарок. Пропорция понятна поставщику и не требует
    // от него попадать в копейку.
    const perDay = env.subscriptionPriceTenge / env.subscriptionPeriodDays;
    // Не меньше дня за любой дошедший платёж: округление вниз при мелкой
    // сумме дало бы ноль дней за реальные деньги.
    const days = Math.max(1, Math.floor(sumTenge / perDay));

    try {
      const paid = await this.record(
        txnId,
        account,
        supplier.id,
        sumTenge,
        txnDateRaw,
        KaspiResult.OK,
        "OK",
        days,
      );
      await this.billing.extendSubscription(supplier.id, days, "kaspi");
      return paid;
    } catch (err) {
      // Гонка: два одинаковых txn_id пришли одновременно и уникальный индекс
      // отбил второй. Это ровно тот случай, ради которого индекс и стоит —
      // отдаём результат победителя.
      const race = await this.prisma.kaspiPayment.findUnique({ where: { txnId } });
      if (race) return this.replay(race);
      this.logger.error(`Не удалось провести платёж ${txnId}: ${(err as Error).message}`);
      return { txn_id: txnId, result: KaspiResult.ERROR, comment: "Внутренняя ошибка" };
    }
  }

  private replay(p: { txnId: string; prvTxnId: number; result: number; sumTenge: number | null; comment: string | null }): KaspiResponse {
    return {
      txn_id: p.txnId,
      prv_txn_id: String(p.prvTxnId),
      result: p.result,
      ...(p.sumTenge !== null ? { sum: this.money(p.sumTenge) } : {}),
      ...(p.comment ? { comment: p.comment } : {}),
    };
  }

  private async record(
    txnId: string,
    account: string,
    supplierId: string | null,
    sumTenge: number | null,
    txnDateRaw: string | undefined,
    result: number,
    comment: string,
    daysGranted?: number,
  ): Promise<KaspiResponse> {
    const row = await this.prisma.kaspiPayment.create({
      data: {
        txnId,
        account,
        supplierId,
        sumTenge,
        txnDate: parseKaspiDate(txnDateRaw),
        result,
        comment,
        daysGranted,
      },
    });
    return this.replay(row);
  }
}

/**
 * ГГГГММДДЧЧММСС → Date.
 *
 * Банк ведёт учёт по этой дате, а не по времени получения запроса: платёж в
 * 23:59:59 31 декабря доедет до нас уже первого января, и в сверке разойдётся
 * отчётный период. Поэтому храним именно её.
 *
 * Часовой пояс в формате не передаётся; трактуем как местное время сервера,
 * который живёт в той же зоне, что и банк.
 */
export function parseKaspiDate(raw: string | undefined): Date | null {
  if (!raw || !/^\d{14}$/.test(raw)) return null;
  const n = (from: number, len: number) => Number(raw.slice(from, from + len));
  const d = new Date(n(0, 4), n(4, 2) - 1, n(6, 2), n(8, 2), n(10, 2), n(12, 2));
  return Number.isNaN(d.getTime()) ? null : d;
}
