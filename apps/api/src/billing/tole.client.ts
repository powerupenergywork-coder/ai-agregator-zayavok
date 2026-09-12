import { Injectable, Logger } from "@nestjs/common";
import { env } from "../config/env";

/**
 * HTTP-адаптер Tole (tolepay.kz) — счета Kaspi без договора с банком.
 *
 * Здесь только транспорт: заголовки, таймаут, разбор трёх видов ответа и
 * никакой бизнес-логики. Решения о деньгах принимает ToleBillerService.
 *
 * Единственный источник схем — их OpenAPI (https://api.tolepay.kz/v1/openapi.json).
 * Полей, которых там нет, мы не придумываем: недостающее берём сверкой
 * платёжного намерения, а не догадками о теле вебхука.
 */

/** Ответ на создание счёта: либо готово, либо команда ещё выполняется. */
export type ToleCreateResult =
  | { kind: "created"; operationId: string; commandId?: string; paymentUrl?: string }
  | { kind: "in_progress"; commandId: string }
  /**
   * Kaspi мог счёт создать, а мог и нет. Повторять нельзя — получим два
   * счёта на один и тот же месяц подписки. Разбираем сверкой.
   */
  | { kind: "outcome_unknown"; commandId: string };

/** Состояние платёжного намерения — то, по чему мы судим об оплате. */
export interface ToleIntent {
  id: string;
  status: "pending" | "paid" | "cancelled" | "expired" | "failed" | "partially_refunded" | "refunded";
  amount: number;
  paidAt: string | null;
}

export class ToleError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ToleError";
  }

  /** Повторять безопасно: ошибка инфраструктуры, а не запроса. */
  get retryable(): boolean {
    return this.status === 429 || this.status === 503 || this.status >= 500;
  }
}

@Injectable()
export class ToleClient {
  private readonly logger = new Logger("Tole");

  private headers(idempotencyKey?: string): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${env.toleApiKey}`,
      "Content-Type": "application/json",
    };
    // В sandbox подключение обязательно, в live — только если счетов больше
    // одного. Пустую строку не шлём: заголовок без значения Tole отклоняет.
    if (env.toleConnectionId) h["X-Tole-Connection-Id"] = env.toleConnectionId;
    if (idempotencyKey) h["Idempotency-Key"] = idempotencyKey;
    return h;
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    opts: { body?: unknown; idempotencyKey?: string } = {},
  ): Promise<{ status: number; json: any }> {
    const url = `${env.toleBaseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.toleTimeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: this.headers(opts.idempotencyKey),
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // Ответ не JSON — это уже не Tole, а что-то на пути к нему.
        throw new ToleError(res.status, "TOLE_BAD_RESPONSE", `Нераспознанный ответ (${res.status})`);
      }
      return { status: res.status, json };
    } catch (err) {
      if (err instanceof ToleError) throw err;
      const aborted = (err as Error).name === "AbortError";
      throw new ToleError(
        aborted ? 504 : 502,
        aborted ? "TOLE_TIMEOUT" : "TOLE_UNREACHABLE",
        // Ни ключа, ни телефона в тексте ошибки: она попадёт в лог.
        aborted ? `Tole не ответил за ${env.toleTimeoutMs} мс` : `Tole недоступен: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private fail(status: number, json: any): never {
    throw new ToleError(status, String(json?.code ?? "TOLE_ERROR"), String(json?.message ?? `Ошибка ${status}`));
  }

  /**
   * Счёт на номер телефона. Придёт в приложение Kaspi этого номера.
   *
   * `idempotencyKey` обязан быть производным от нашего счёта, а не случайным:
   * повтор после обрыва связи должен вернуть тот же счёт, а не выставить
   * второй. Ключ — номер нашего счёта, он и так уникален.
   */
  async createInvoice(opts: {
    phoneNumber: string;
    amountTenge: number;
    comment?: string;
    idempotencyKey: string;
  }): Promise<ToleCreateResult> {
    const { status, json } = await this.request("POST", "/invoices", {
      idempotencyKey: opts.idempotencyKey,
      body: {
        phoneNumber: opts.phoneNumber,
        amount: opts.amountTenge,
        ...(opts.comment ? { comment: opts.comment.slice(0, 200) } : {}),
      },
    });

    if (status === 200 || status === 201) {
      const id = json?.data?.id;
      if (!id) this.fail(status, { code: "TOLE_NO_ID", message: "Ответ без идентификатора счёта" });
      return {
        kind: "created",
        operationId: String(id),
        commandId: json?.commandId ? String(json.commandId) : undefined,
        paymentUrl: json?.data?.paymentUrl ?? json?.data?.receiptUrl ?? undefined,
      };
    }
    if (status === 202) {
      const commandId = String(json?.commandId ?? "");
      if (!commandId) this.fail(status, { code: "TOLE_NO_COMMAND", message: "Ответ 202 без commandId" });
      return json?.kind === "outcome_unknown"
        ? { kind: "outcome_unknown", commandId }
        : { kind: "in_progress", commandId };
    }
    this.fail(status, json);
  }

  /** Чем закончилась команда, ответившая 202. */
  async getCommand(commandId: string): Promise<{ status: string; operationId?: string }> {
    const { status, json } = await this.request("GET", `/commands/${encodeURIComponent(commandId)}`);
    if (status !== 200) this.fail(status, json);
    return {
      status: String(json?.data?.status ?? "unknown"),
      operationId: json?.data?.result?.data?.id ? String(json.data.result.data.id) : undefined,
    };
  }

  /**
   * Платёжное намерение — долговечное состояние счёта в реестре Tole.
   *
   * Именно по нему мы решаем, оплачено ли: тело вебхука по их же схеме
   * идентификатора платежа не содержит, а состояние у провайдера содержит.
   */
  async getIntent(operationId: string): Promise<ToleIntent> {
    const { status, json } = await this.request(
      "GET",
      `/payment-intents/invoices/${encodeURIComponent(operationId)}`,
    );
    if (status !== 200) this.fail(status, json);
    const d = json?.data ?? json;
    return {
      id: String(d?.id ?? operationId),
      status: String(d?.status ?? "pending") as ToleIntent["status"],
      amount: Number(d?.amount ?? 0),
      paidAt: d?.paidAt ?? null,
    };
  }

  /**
   * Есть ли у номера Kaspi, способный принять счёт.
   *
   * Спрашиваем до выставления: счёт, ушедший в никуда, исполнитель не увидит
   * и решит, что мы просто требуем денег без всякой возможности заплатить.
   */
  async clientEligible(phoneNumber: string): Promise<boolean> {
    try {
      const { status, json } = await this.request("POST", "/invoices/client-info", { body: { phoneNumber } });
      if (status !== 200) return false;
      return json?.data?.eligible !== false;
    } catch (err) {
      // Недоступность проверки — не повод не выставлять счёт: хуже молча
      // ничего не сделать, чем выставить счёт человеку без Kaspi.
      this.logger.warn(`Проверка получателя не удалась: ${(err as Error).message}`);
      return true;
    }
  }
}
