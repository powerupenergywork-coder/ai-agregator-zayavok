-- Атрибуция рекламы Click-to-WhatsApp: источник запоминается на сессии, потому
-- что Meta присылает referral только в первом сообщении после клика, а черновик
-- заявки создаётся позже.
ALTER TABLE "WhatsAppSession" ADD COLUMN "adSource" TEXT;
ALTER TABLE "WhatsAppSession" ADD COLUMN "adParams" JSONB;
ALTER TABLE "WhatsAppSession" ADD COLUMN "adAt" TIMESTAMP(3);
