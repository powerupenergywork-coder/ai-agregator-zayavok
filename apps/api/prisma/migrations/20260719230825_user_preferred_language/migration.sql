-- CreateEnum
CREATE TYPE "Language" AS ENUM ('RU', 'KK');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "preferredLanguage" "Language" NOT NULL DEFAULT 'RU';

