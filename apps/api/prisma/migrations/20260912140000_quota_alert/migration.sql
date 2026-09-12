-- Одно предупреждение владельцу на исполнителя в месяц: отметка сбрасывается
-- первого числа вместе со счётчиком заявок (см. resetMonthlyQuotas).
ALTER TABLE "SupplierProfile" ADD COLUMN "quotaAlertAt" TIMESTAMP(3);
