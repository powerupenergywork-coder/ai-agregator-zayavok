export interface CreatePaymentOptions {
  amountTenge: number;
  description: string;
  /** Our own reference, echoed back in the confirmation webhook so BillingService can find the row. */
  reference: string;
}

export interface PaymentProvider {
  /** Returns a URL the supplier opens to pay — a real checkout page (Kaspi) or, in dev, an instant mock-confirm link. */
  createPayment(opts: CreatePaymentOptions): Promise<{ paymentUrl: string }>;
}

export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");
