/**
 * Публичный адрес сайта. Нужен там, где ссылка обязана быть абсолютной:
 * карта сайта, canonical, robots. Берётся из окружения, чтобы превью-сборка
 * не объявляла себя боевым доменом.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://kerektap.kz").replace(/\/$/, "");

/**
 * Номер бота в WhatsApp — константой, а не запросом к API.
 *
 * Страницы услуг собираются статически, и тянуть номер с сервера во время
 * сборки значит поставить их в зависимость от него. Номер меняется раз в
 * никогда, а страница должна открываться всегда.
 */
export const BOT_PHONE = process.env.NEXT_PUBLIC_BOT_PHONE || "77089526570";

/** Тот же номер в человеческом виде — для показа и для ссылки tel:. */
export const BOT_PHONE_PRETTY = "+7 708 952 6570";

/** Ссылка на чат с ботом с уже подставленным первым сообщением. */
export function whatsappLink(text: string): string {
  return `https://wa.me/${BOT_PHONE}?text=${encodeURIComponent(text)}`;
}
