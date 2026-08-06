-- Стенограмма переписки в WhatsApp + честный статус доставки.
--
-- До этого вся сторона поставщика (онбординг, «стоп», «баланс», согласие
-- взять заявку) нигде не сохранялась: ChatMessage покрывает только диалог на
-- сайте. А статус SENT в NotificationLog означал лишь «провайдер принял
-- запрос» — реальный отказ приходит асинхронным вебхуком и жил только в
-- логах контейнера, которые перетираются.

CREATE TYPE "MessageDirection" AS ENUM ('IN', 'OUT');

ALTER TABLE "NotificationLog"
  ADD COLUMN "providerMessageId" TEXT,
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "readAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "NotificationLog_providerMessageId_key"
  ON "NotificationLog"("providerMessageId");

CREATE TABLE "WhatsAppMessage" (
  "id" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "direction" "MessageDirection" NOT NULL,
  "kind" TEXT NOT NULL,
  "text" TEXT,
  "payload" TEXT,
  "unrecognized" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WhatsAppMessage_phone_createdAt_idx"
  ON "WhatsAppMessage"("phone", "createdAt");

-- Отдельный индекс под главный рабочий запрос: «покажи всё, что бот не понял».
CREATE INDEX "WhatsAppMessage_unrecognized_createdAt_idx"
  ON "WhatsAppMessage"("unrecognized", "createdAt");
