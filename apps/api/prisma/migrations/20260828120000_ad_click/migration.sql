-- Клик по объявлению, дожидающийся своей заявки.
CREATE TABLE "AdClick" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "clickId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'google',
    "params" JSONB,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdClick_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdClick_token_key" ON "AdClick"("token");
CREATE INDEX "AdClick_createdAt_idx" ON "AdClick"("createdAt");
