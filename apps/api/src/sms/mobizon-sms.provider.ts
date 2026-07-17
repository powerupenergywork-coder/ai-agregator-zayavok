import { Injectable } from "@nestjs/common";
import { env } from "../config/env";
import { SmsProvider } from "./sms-provider.interface";

/**
 * Placeholder for a real Kazakhstan SMS gateway (e.g. Mobizon). Not wired to
 * a live API — fill in the HTTP call once MOBIZON_API_KEY is issued. Kept as
 * a separate adapter so switching SMS_PROVIDER in .env is the only change
 * needed anywhere else in the codebase.
 */
@Injectable()
export class MobizonSmsProvider implements SmsProvider {
  async send(phone: string, message: string): Promise<void> {
    if (!env.mobizonApiKey) {
      throw new Error(
        "SMS_PROVIDER=mobizon requires MOBIZON_API_KEY to be set. " +
          "Falling back is not automatic — set SMS_PROVIDER=console for local dev.",
      );
    }
    throw new Error("Mobizon integration not implemented yet — TODO before production use.");
  }
}
