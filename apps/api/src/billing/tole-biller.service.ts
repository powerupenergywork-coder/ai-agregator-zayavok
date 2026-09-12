import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ToleClient, ToleError } from "./tole.client";

/**
 * Шлюз к Tole: выставить счёт и узнать, оплачен ли он.
 *
 * Денег эта служба не двигает и подписок не продлевает — она только говорит
 * с Tole и хранит следы разговора в счёте. Решение «оплачено, значит продлить»
 * принимает BillingService, у которого для этого уже всё есть.
 *
 * Направление зависимостей тут одностороннее (Billing → Tole → HTTP) —
 * поэтому в модуле нет forwardRef, а порядок событий читается сверху вниз.
 */
@Injectable()
export class ToleBillerService {
  private readonly logger = new Logger("ToleBiller");

  constructor(
    private readonly prisma: PrismaService,
    private readonly tole: ToleClient,
  ) {}

  /**
   * Ключ идемпотентности выводим из номера счёта, а не из случайного uuid.
   *
   * Смысл ключа в том, чтобы повтор после обрыва связи вернул ТОТ ЖЕ счёт.
   * Случайный ключ на каждой попытке даёт обратное: два счёта на один месяц
   * подписки и два списания у исполнителя.
   */
  private idempotencyKey(invoiceNumber: string): string {
    return `kerektap-invoice-${invoiceNumber}`;
  }

  /**
   * Отправить счёт в приложение Kaspi исполнителя.
   *
   * Возвращает `true`, если счёт у Tole есть и человеку есть что оплатить.
   * `false` — если выставить не удалось: тогда наверх уйдёт не номер счёта, а
   * телефон поддержки. Неоплатимый счёт хуже отсутствия счёта — исполнитель
   * читает его как требование денег без возможности заплатить.
   */
  async deliverInvoice(
    invoice: { id: string; number: string; amountTenge: number; periodDays: number; externalId: string | null },
    phone: string,
  ): Promise<boolean> {
    if (invoice.externalId) return true;

    try {
      const result = await this.tole.createInvoice({
        phoneNumber: normalizePhone(phone),
        amountTenge: invoice.amountTenge,
        comment: `KerekTap: подписка на ${invoice.periodDays} дней, счёт №${invoice.number}`,
        idempotencyKey: this.idempotencyKey(invoice.number),
      });

      if (result.kind === "created") {
        await this.prisma.subscriptionInvoice.update({
          where: { id: invoice.id },
          data: { provider: "tole", externalId: result.operationId, externalCommandId: result.commandId ?? null },
        });
        this.logger.log(`Счёт №${invoice.number} выставлен в Tole`);
        return true;
      }

      // 202. Счёт, возможно, уже создан — второй раз не просим ни при каком
      // из двух исходов: `in_progress` доведёт до конца сверка команды,
      // `outcome_unknown` вообще запрещено повторять (см. их документацию).
      await this.prisma.subscriptionInvoice.update({
        where: { id: invoice.id },
        data: { provider: "tole", externalCommandId: result.commandId },
      });
      this.logger.warn(`Счёт №${invoice.number}: Tole ответил ${result.kind}, разберём сверкой`);
      return result.kind === "in_progress";
    } catch (err) {
      const e = err as ToleError;
      this.logger.error(`Счёт №${invoice.number} не выставлен: ${e.code ?? "?"} ${e.message}`);
      return false;
    }
  }

  /**
   * Догнать команду, которая ответила 202: узнать, появился ли счёт.
   *
   * Без этого счёт с `externalCommandId`, но без `externalId` остался бы
   * невидимым навсегда: платёж по нему пришёл бы, а сопоставить его было бы
   * не с чем.
   */
  async resolveCommand(invoice: {
    id: string;
    number: string;
    externalCommandId: string | null;
  }): Promise<string | null> {
    if (!invoice.externalCommandId) return null;
    try {
      const cmd = await this.tole.getCommand(invoice.externalCommandId);
      if (cmd.operationId) {
        await this.prisma.subscriptionInvoice.update({
          where: { id: invoice.id },
          data: { provider: "tole", externalId: cmd.operationId },
        });
        this.logger.log(`Счёт №${invoice.number}: команда завершилась, операция найдена`);
        return cmd.operationId;
      }
      return null;
    } catch (err) {
      this.logger.warn(`Счёт №${invoice.number}: команду дочитать не удалось — ${(err as Error).message}`);
      return null;
    }
  }

  /** Оплачен ли счёт по данным Tole. `null` — спросить не удалось. */
  async paymentStatus(externalId: string): Promise<{ paid: boolean; amountTenge: number } | null> {
    try {
      const intent = await this.tole.getIntent(externalId);
      return { paid: intent.status === "paid", amountTenge: Math.round(intent.amount) };
    } catch (err) {
      this.logger.warn(`Сверка ${externalId.slice(0, 8)}… не удалась: ${(err as Error).message}`);
      return null;
    }
  }
}

/**
 * Tole принимает `+7XXXXXXXXXX`. У нас телефоны хранятся в разном виде — с
 * плюсом, без плюса, с восьмёркой в начале, — и «8 701…» без приведения
 * улетело бы как неверный формат.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  const ten = digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8")) ? digits.slice(1) : digits;
  return `+7${ten}`;
}
