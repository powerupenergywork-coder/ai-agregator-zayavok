-- Журнал платежей Kaspi по протоколу биллера.
-- prvTxnId — SERIAL: протокол требует вернуть в prv_txn целое число,
-- уникальное в базе провайдера.
CREATE TABLE "KaspiPayment" (
    "id" TEXT NOT NULL,
    "txnId" TEXT NOT NULL,
    "prvTxnId" SERIAL NOT NULL,
    "account" TEXT NOT NULL,
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
