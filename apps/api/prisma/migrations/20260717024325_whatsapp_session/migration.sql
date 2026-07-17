-- AlterTable
ALTER TABLE "User" ADD COLUMN     "preferredChannel" "NotificationChannel" NOT NULL DEFAULT 'SMS';

-- CreateTable
CREATE TABLE "WhatsAppSession" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "flow" TEXT NOT NULL DEFAULT 'client_order',
    "currentOrderId" TEXT,
    "stateData" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppSession_chatId_key" ON "WhatsAppSession"("chatId");

-- CreateIndex
CREATE INDEX "WhatsAppSession_phone_idx" ON "WhatsAppSession"("phone");
