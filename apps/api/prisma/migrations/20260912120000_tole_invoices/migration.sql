-- Счета через Tole: чей счёт, какая операция у них, сколько реально заплатили.
--
-- provider по умолчанию kaspi — все существующие счета выставлены биллером,
-- и переписывать их нечем и незачем.
ALTER TABLE "SubscriptionInvoice" ADD COLUMN "paidAmountTenge" INTEGER;
ALTER TABLE "SubscriptionInvoice" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'kaspi';
ALTER TABLE "SubscriptionInvoice" ADD COLUMN "externalId" TEXT;
ALTER TABLE "SubscriptionInvoice" ADD COLUMN "externalCommandId" TEXT;

CREATE UNIQUE INDEX "SubscriptionInvoice_externalId_key" ON "SubscriptionInvoice"("externalId");
CREATE INDEX "SubscriptionInvoice_provider_status_idx" ON "SubscriptionInvoice"("provider", "status");

-- Журнал событий вебхука Tole. Идентификатор события — первичный ключ:
-- повторную доставку отбивает база, а не проверка в коде.
CREATE TABLE "TolePaymentEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "invoiceId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TolePaymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TolePaymentEvent_createdAt_idx" ON "TolePaymentEvent"("createdAt");

ALTER TABLE "TolePaymentEvent" ADD CONSTRAINT "TolePaymentEvent_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "SubscriptionInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
