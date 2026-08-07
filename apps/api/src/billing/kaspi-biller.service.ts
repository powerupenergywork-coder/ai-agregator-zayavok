import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { env } from "../config/env";
import { BillingService } from "./billing.service";

/**
 * Коды ответа из «Протокола взаимодействия (онлайн)». Банк читает только
 * число; comment существует для человека, разбирающего спорный платёж.
 */
export const KaspiResult = {
  OK: 0,
  /** Счёта с таким номером нет. */
  NOT_FOUND: 1,
  /** Счёт отменён или просрочен. */
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
  /**
   * Наш номер оплаты. Отдаём под двумя именами намеренно: в протоколе
   * XML-пример называет это поле prv_txn, а JSON-пример — prv_txn_id, и какое
   * из двух читает их парсер, снаружи не видно. Лишнее поле безвредно,
   * отсутствующее — провал платежа на тестах.
   */
  prv_txn?: string;
  prv_txn_id?: string;
  comment?: string;
  fields?: Record<string, { "@name": string; "#text": string }>;
}

/**
 * Приём платежей по протоколу биллера Kaspi.
 *
 * Направление обратное привычному шлюзу: мы не создаём платёж и не отдаём
 * ссылку. Поставщик получает от нас номер счёта, кто-то открывает Kaspi,
 * находит нашу услугу, вводит этот номер и платит — а банк дёргает наш
 * endpoint дважды: сначала check («такой счёт есть? сколько по нему?»), потом
 * pay («деньги внесены»).
 *
 * Идентификатор — номер счёта, а не телефон. Платит не обязательно сам
 * поставщик: за исполнителя платят бухгалтер, жена, сын с другого телефона, и
 * поиск по номеру плательщика нашёл бы не того человека или никого. Протокол
 * прямо разрешает «номер заказа» наравне с лицевым счётом.
 *
 * Идемпотентность обязательна и не опциональна: протокол требует, чтобы
 * повторный txn_id вернул результат предыдущей обработки. Kaspi повторяет
 * запрос при любом обрыве, так что второй раз приходит штатно, а не в аварии.
 * Реализована уникальным индексом на KaspiPayment.txnId — гонку разрешает
 * база, а не наша проверка «а нет ли уже такого».
 */
@Injectable()
export class KaspiBillerService {
  private readonly logger = new Logger(KaspiBillerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  /** Плательщик может набрать номер с пробелами или дефисами — цифры и есть
   * номер. Всё остальное отсекаем до похода в базу. */
  private toNumber(account: string): string | null {
    const digits = account.replace(/\D/g, "");
    return /^\d{8}$/.test(digits) ? digits : null;
  }

  private async findInvoice(account: string) {
    const number = this.toNumber(account);
    if (!number) return null;
    return this.prisma.subscriptionInvoice.findUnique({
      where: { number },
      include: { supplier: { include: { user: true } } },
    });
  }

  private money(tenge: number): string {
    return tenge.toFixed(2);
  }

  /**
   * «Есть такой счёт и можно ли по нему платить».
   *
   * Ничего не меняет: check приходит и просто так, когда человек листает
   * форму оплаты. Сумму из запроса игнорируем — протокол говорит прямо, что
   * в check она фиктивная, а нужную сумму называем мы сами.
   *
   * В fields отдаём, за кого счёт: плательщик увидит это в приложении и
   * поймёт, что не ошибся номером. Стоит одной строки, а «оплатил не тот
   * счёт» стоит возврата.
   */
  async check(txnId: string, account: string): Promise<KaspiResponse> {
    if (!env.kaspiBillerEnabled) {
      return { txn_id: txnId, result: KaspiResult.ERROR, comment: "Приём платежей не настроен" };
    }
    const invoice = await this.findInvoice(account);
    if (!invoice) {
      return { txn_id: txnId, result: KaspiResult.NOT_FOUND, comment: "Счёт не найден" };
    }
    if (invoice.status === "PAID") {
      return { txn_id: txnId, result: KaspiResult.ALREADY_PAID, comment: "Счёт уже оплачен" };
    }
    if (invoice.status !== "PENDING") {
      return { txn_id: txnId, result: KaspiResult.CANCELLED, comment: "Счёт отменён" };
    }
    if (invoice.expiresAt <= new Date()) {
      return { txn_id: txnId, result: KaspiResult.CANCELLED, comment: "Срок оплаты счёта истёк" };
    }
    return {
      txn_id: txnId,
      result: KaspiResult.OK,
      sum: this.money(invoice.amountTenge),
      comment: "OK",
      fields: {
        field1: {
          "@name": "Исполнитель",
          "#text": invoice.supplier.companyName ?? invoice.supplier.user.phone,
        },
        field2: { "@name": "Услуга", "#text": `Подписка на ${invoice.periodDays} дней` },
      },
    };
  }

  /**
   * «Деньги внесены — зачисляй».
   *
   * Сначала записываем транзакцию, и только если запись прошла — закрываем
   * счёт и продлеваем подписку. Уникальный индекс на txnId означает, что при
   * повторе вставка упадёт, мы прочитаем прошлый ответ и вернём его дословно,
   * ничего не начислив второй раз.
   *
   * Ошибку возвращаем только если действительно не можем зачислить: деньги в
   * этот момент уже списаны, и «ошибка провайдера» после списания — это
   * разбирательство в поддержке, а не техническая деталь.
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

    const invoice = await this.findInvoice(account);
    const sumTenge = Math.floor(Number(sumRaw));
    if (!Number.isFinite(sumTenge) || sumTenge <= 0) {
      return this.record(txnId, account, null, null, null, txnDateRaw, KaspiResult.ERROR, "Некорректная сумма");
    }
    if (!invoice) {
      return this.record(txnId, account, null, null, sumTenge, txnDateRaw, KaspiResult.NOT_FOUND, "Счёт не найден");
    }
    if (invoice.status === "PAID") {
      // Не ошибка и не повод для возврата: одновременно платить один счёт
      // дважды никто не станет, а вот повторить оплату по невнимательности —
      // запросто. Код 3 банк показывает плательщику как «уже оплачено».
      return this.record(
        txnId,
        account,
        invoice.id,
        invoice.supplierId,
        sumTenge,
        txnDateRaw,
        KaspiResult.ALREADY_PAID,
        "Счёт уже оплачен",
      );
    }

    // Дней столько, за сколько заплатили. Сумму называем мы, но если банк
    // всё-таки пропустит другую, оба простых варианта плохи: отказать после
    // списания — разбирательство в поддержке, выдать полный период за
    // половину денег — подарок.
    const perDay = invoice.amountTenge / invoice.periodDays;
    // Не меньше дня за любой дошедший платёж: округление вниз при мелкой
    // сумме дало бы ноль дней за реальные деньги.
    const days = Math.max(1, Math.floor(sumTenge / perDay));

    try {
      const paid = await this.record(
        txnId,
        account,
        invoice.id,
        invoice.supplierId,
        sumTenge,
        txnDateRaw,
        KaspiResult.OK,
        "OK",
        days,
      );
      await this.prisma.subscriptionInvoice.update({
        where: { id: invoice.id },
        data: { status: "PAID", paidAt: new Date() },
      });
      await this.billing.extendSubscription(invoice.supplierId, days, "kaspi");
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

  private replay(p: {
    txnId: string;
    prvTxnId: number;
    result: number;
    sumTenge: number | null;
    comment: string | null;
  }): KaspiResponse {
    return {
      txn_id: p.txnId,
      prv_txn: String(p.prvTxnId),
      prv_txn_id: String(p.prvTxnId),
      result: p.result,
      ...(p.sumTenge !== null ? { sum: this.money(p.sumTenge) } : {}),
      ...(p.comment ? { comment: p.comment } : {}),
    };
  }

  private async record(
    txnId: string,
    account: string,
    invoiceId: string | null,
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
        invoiceId,
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
