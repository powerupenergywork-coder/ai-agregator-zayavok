-- Служебные заявки: наши тесты и хвосты разговоров с исполнителями.
ALTER TABLE "Order" ADD COLUMN "internal" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Order_internal_idx" ON "Order"("internal");
