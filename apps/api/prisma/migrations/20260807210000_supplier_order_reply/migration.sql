-- Ответ поставщика по конкретной заявке (см. WhatsAppRouterService).
CREATE TABLE "SupplierOrderReply" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierOrderReply_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierOrderReply_orderId_idx" ON "SupplierOrderReply"("orderId");
CREATE INDEX "SupplierOrderReply_supplierId_idx" ON "SupplierOrderReply"("supplierId");

ALTER TABLE "SupplierOrderReply" ADD CONSTRAINT "SupplierOrderReply_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierOrderReply" ADD CONSTRAINT "SupplierOrderReply_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
