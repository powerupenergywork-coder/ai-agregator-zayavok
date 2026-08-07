-- Счёт на оплату подписки. Идентификатор в Kaspi — его номер, а не телефон:
-- платит не обязательно сам поставщик (бухгалтер, родственник, другой номер).
CREATE TABLE "SubscriptionInvoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amountTenge" INTEGER NOT NULL,
    "periodDays" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionInvoice_number_key" ON "SubscriptionInvoice"("number");
CREATE INDEX "SubscriptionInvoice_supplierId_status_idx" ON "SubscriptionInvoice"("supplierId", "status");

ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Журнал платежей Kaspi по протоколу биллера.
-- prvTxnId — SERIAL: протокол требует вернуть в prv_txn целое число,
-- уникальное в базе провайдера.
CREATE TABLE "KaspiPayment" (
    "id" TEXT NOT NULL,
    "txnId" TEXT NOT NULL,
    "prvTxnId" SERIAL NOT NULL,
    "account" TEXT NOT NULL,
    "invoiceId" TEXT,
    "supplierId" TEXT,
    "sumTenge" INTEGER,
    "txnDate" TIMESTAMP(3),
    "result" INTEGER NOT NULL,
    "comment" TEXT,
    "daysGranted" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KaspiPayment_pkey" PRIMARY KEY ("id")
);

-- Уникальность txnId — это и есть идемпотентность: повторный запрос от Kaspi
-- не может провести платёж второй раз, гонку разрешает база, а не приложение.
CREATE UNIQUE INDEX "KaspiPayment_txnId_key" ON "KaspiPayment"("txnId");
CREATE UNIQUE INDEX "KaspiPayment_prvTxnId_key" ON "KaspiPayment"("prvTxnId");
CREATE INDEX "KaspiPayment_account_idx" ON "KaspiPayment"("account");
CREATE INDEX "KaspiPayment_createdAt_idx" ON "KaspiPayment"("createdAt");

ALTER TABLE "KaspiPayment" ADD CONSTRAINT "KaspiPayment_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KaspiPayment" ADD CONSTRAINT "KaspiPayment_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "SubscriptionInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
