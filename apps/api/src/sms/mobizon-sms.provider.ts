import { Injectable, Logger } from "@nestjs/common";
import { env } from "../config/env";
import { normalizePhone } from "../common/phone.util";
import { SmsProvider } from "./sms-provider.interface";

interface MobizonResponse {
  code: number;
  data?: { messageId?: number | string; campaignId?: number | string; status?: number };
  message?: string;
}

/**
 * Mobizon (api.mobizon.kz) — carries the OTP and the publish confirmation for
 * clients whose number has no WhatsApp.
 *
 * Two details of their API are easy to get wrong:
 * - Success is `code: 0` in the body, not the HTTP status. A rejected message
 *   still comes back as HTTP 200, so trusting res.ok would report every
 *   failure — bad key, empty balance, unapproved sender — as delivered.
 * - `recipient` wants bare digits including the country code, no plus.
 */
@Injectable()
export class MobizonSmsProvider implements SmsProvider {
  private readonly logger = new Logger(MobizonSmsProvider.name);

  async send(phone: string, message: string): Promise<void> {
    const recipient = normalizePhone(phone).replace(/\D/g, "");
    const res = await this.call("message/sendSMSMessage", {
      recipient,
      text: message,
      ...(env.mobizonSenderName ? { from: env.mobizonSenderName } : {}),
    });
    this.logger.log(`SMS на ${recipient} принято, messageId=${res.data?.messageId ?? "?"}`);
  }

  /** Cheap way to prove the key and host work without spending a message. */
  async getBalance(): Promise<string> {
    const res = await this.call("user/getOwnBalance", {});
    return JSON.stringify(res.data ?? {});
  }

  private async call(path: string, params: Record<string, string>): Promise<MobizonResponse> {
    if (!env.mobizonApiKey) {
      throw new Error(
        "SMS_PROVIDER=mobizon requires MOBIZON_API_KEY to be set. " +
          "Falling back is not automatic — set SMS_PROVIDER=console for local dev.",
      );
    }

    const body = new URLSearchParams({ apiKey: env.mobizonApiKey, output: "json", api: "v1", ...params });

    let res: Response;
    try {
      res = await fetch(`https://${env.mobizonApiHost}/service/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (err) {
      throw new Error(`Mobizon недоступен: ${(err as Error).message}`);
    }
    if (!res.ok) throw new Error(`Mobizon вернул HTTP ${res.status}`);

    const json = (await res.json()) as MobizonResponse;
    if (json.code !== 0) {
      throw new Error(`Mobizon отклонил запрос (code ${json.code}): ${json.message || "без пояснения"}`);
    }
    return json;
  }
}
