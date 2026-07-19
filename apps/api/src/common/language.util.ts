import { Language } from "@ai-zayavki/shared";

/** Prisma's Language enum values are uppercase ("RU"/"KK"); the shared
 * Language type (used everywhere text actually gets picked) is lowercase. */
export function toLang(prismaLang: "RU" | "KK" | string): Language {
  return prismaLang === "KK" ? "kk" : "ru";
}
