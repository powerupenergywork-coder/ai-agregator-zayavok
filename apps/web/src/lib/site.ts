/**
 * Публичный адрес сайта. Нужен там, где ссылка обязана быть абсолютной:
 * карта сайта, canonical, robots. Берётся из окружения, чтобы превью-сборка
 * не объявляла себя боевым доменом.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://kerektap.kz").replace(/\/$/, "");
