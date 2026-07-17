import { Injectable } from "@nestjs/common";
import { env } from "../config/env";
import { CreatePaymentOptions, PaymentProvider } from "./payment-provider.interface";

/**
 * Placeholder for real Kaspi Pay integration — not wired to a live API.
 * Same pattern as sms/mobizon-sms.provider.ts: switching PAYMENT_PROVIDER in
 * .env is the only change needed anywhere else once this is implemented.
 * Requires a Kaspi merchant agreement (business/legal step, not engineering)
 * before KASPI_MERCHANT_ID/KASPI_API_KEY mean anything.
 */
@Injectable()
export class KaspiPaymentProvider implements PaymentProvider {
  async createPayment(_opts: CreatePaymentOptions): Promise<{ paymentUrl: string }> {
    if (!env.kaspiMerchantId || !env.kaspiApiKey) {
      throw new Error(
        "PAYMENT_PROVIDER=kaspi requires KASPI_MERCHANT_ID and KASPI_API_KEY. " +
          "Use PAYMENT_PROVIDER=mock for local dev.",
      );
    }
    throw new Error("Kaspi Pay integration not implemented yet — TODO before production use.");
  }
}
