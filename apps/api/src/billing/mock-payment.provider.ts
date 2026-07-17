import { Injectable, Logger } from "@nestjs/common";
import { env } from "../config/env";
import { CreatePaymentOptions, PaymentProvider } from "./payment-provider.interface";

/**
 * Dev-mode stand-in — no real money changes hands. The "checkout page" is
 * just GET /billing/mock-confirm/:reference on our own API, which
 * immediately activates the subscription (see BillingController). Good
 * enough to exercise the whole quota/subscribe flow without a Kaspi contract.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger("Payment(mock)");

  async createPayment(opts: CreatePaymentOptions): Promise<{ paymentUrl: string }> {
    this.logger.log(`Created mock payment ${opts.reference} for ${opts.amountTenge} ₸: ${opts.description}`);
    return { paymentUrl: `${env.apiUrl}/billing/mock-confirm/${opts.reference}` };
  }
}
