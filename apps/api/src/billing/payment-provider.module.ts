import { Global, Module } from "@nestjs/common";
import { env } from "../config/env";
import { PAYMENT_PROVIDER } from "./payment-provider.interface";
import { MockPaymentProvider } from "./mock-payment.provider";
import { KaspiPaymentProvider } from "./kaspi-payment.provider";

@Global()
@Module({
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      useClass: env.paymentProvider === "kaspi" ? KaspiPaymentProvider : MockPaymentProvider,
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentProviderModule {}
