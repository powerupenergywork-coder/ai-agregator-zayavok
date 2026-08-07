-- Отметка «напоминание о брошенном черновике отправлено» (см. OrdersService).
ALTER TABLE "Order" ADD COLUMN "draftNudgeAt" TIMESTAMP(3);
