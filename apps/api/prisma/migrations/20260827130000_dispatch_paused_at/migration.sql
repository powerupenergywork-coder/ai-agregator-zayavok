-- Клиент попросил перестать рассылать, не закрывая заявку.
ALTER TABLE "Order" ADD COLUMN "dispatchPausedAt" TIMESTAMP(3);
