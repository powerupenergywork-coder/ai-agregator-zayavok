-- Отметка «предупредили об окончании текущего периода» — см.
-- BillingService.issueRenewalInvoices(). Без неё ежедневная проверка слала бы
-- напоминание каждый день подряд.
ALTER TABLE "SupplierSubscription" ADD COLUMN "expiryNoticeAt" TIMESTAMP(3);
