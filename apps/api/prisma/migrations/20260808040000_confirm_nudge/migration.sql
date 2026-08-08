-- Отметка «напомнили о неподтверждённой заявке» (см. OrdersService).
ALTER TABLE "Order" ADD COLUMN "confirmNudgeAt" TIMESTAMP(3);
