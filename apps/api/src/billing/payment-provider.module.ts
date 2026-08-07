import { Global, Module } from "@nestjs/common";
import { PAYMENT_PROVIDER } from "./payment-provider.interface";
import { MockPaymentProvider } from "./mock-payment.provider";

/**
 * Провайдеры со шлюзом «создай платёж — получи ссылку». Kaspi сюда не входит
 * и входить не может: по протоколу биллера платёж создаёт банк, а не мы, и
 * ссылки в этой схеме не бывает. Приём Kaspi живёт в kaspi-biller.service.ts
 * и включается флагом KASPI_BILLER_ENABLED, а не PAYMENT_PROVIDER.
 */
@Global()
@Module({
  providers: [{ provide: PAYMENT_PROVIDER, useClass: MockPaymentProvider }],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentProviderModule {}
