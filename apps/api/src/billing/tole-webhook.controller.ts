import { Controller, HttpCode, Logger, Post, RawBodyRequest, Req } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { createHmac, timingSafeEqual } from "crypto";
import type { Request } from "express";
import { env } from "../config/env";
import { BillingService } from "./billing.service";

/**
 * Вебхук Tole: https://kerektap.kz/api/tole/webhook
 *
 * Тело события по их схеме НЕ содержит идентификатора платежа — только id
 * самого события, тип и служебные поля. Поэтому вебхук у нас не источник
 * истины, а сигнал «что-то изменилось»: получив его, мы идём сверять свои
 * открытые счета с платёжными намерениями Tole. Та же сверка идёт по
 * расписанию, так что потерянный вебхук означает задержку, а не потерю денег.
 *
 * Лимит запросов снят намеренно: 429 в ответ Tole прочитает как неудачную
 * доставку и будет повторять, а защита здесь и так не в счётчике, а в подписи.
 */
@SkipThrottle()
@Controller("tole")
export class ToleWebhookController {
  private readonly logger = new Logger("ToleWebhook");

  constructor(private readonly billing: BillingService) {}

  /**
   * 200 отдаём только после того, как событие записано и сверка проведена:
   * до этого момента «принято» было бы неправдой, а Tole по 2xx перестаёт
   * повторять доставку.
   *
   * На неверную подпись отвечаем тоже 200 — но ничего не делаем. Ответ
   * ошибкой подсказал бы подбирающему, что он близок; повторять доставку
   * такого события всё равно бессмысленно.
   */
  @Post("webhook")
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>): Promise<{ ok: boolean }> {
    const id = String(req.headers["webhook-id"] ?? "");
    const timestamp = String(req.headers["webhook-timestamp"] ?? "");
    const signature = String(req.headers["webhook-signature"] ?? "");

    if (!verifyToleSignature(req.rawBody, id, timestamp, signature, env.toleWebhookSecret)) {
      this.logger.warn(`Событие ${id || "без id"}: подпись не сошлась, пропускаю`);
      return { ok: true };
    }

    let event: { id?: string; type?: string; data?: unknown };
    try {
      event = JSON.parse(req.rawBody!.toString("utf8"));
    } catch {
      this.logger.warn(`Событие ${id}: тело не разобралось как JSON`);
      return { ok: true };
    }

    await this.billing.handleToleEvent({
      id: String(event.id ?? id),
      type: String(event.type ?? "unknown"),
      data: event.data,
    });
    return { ok: true };
  }
}

/**
 * Подпись считается по СЫРОМУ телу до разбора JSON: пересобранный из объекта
 * текст отличается от присланного пробелами и порядком ключей, и подпись к
 * нему не сходится. Ровно этим ломается большинство интеграций вебхуков.
 *
 * Формат — из их документации: v1=hex(HMAC-SHA256(secret, "id.timestamp.body")).
 */
export function verifyToleSignature(
  rawBody: Buffer | undefined,
  id: string,
  timestamp: string,
  signature: string,
  secret: string,
): boolean {
  if (!rawBody || !id || !timestamp || !signature || !secret) return false;

  // Старое событие принимать нельзя: перехваченное однажды, оно иначе
  // оставалось бы годным навсегда — подпись у него настоящая.
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return false;
  const ageSeconds = Math.abs(Date.now() / 1000 - sentAt);
  if (ageSeconds > env.toleWebhookToleranceSeconds) return false;

  const expected = `v1=${createHmac("sha256", secret).update(`${id}.${timestamp}.${rawBody.toString("utf8")}`, "utf8").digest("hex")}`;
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  // Длину сравниваем отдельно: timingSafeEqual на разной длине бросает.
  return a.length === b.length && timingSafeEqual(a, b);
}
