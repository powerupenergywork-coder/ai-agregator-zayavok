import { getAttribution } from "./attribution";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const KEY = "kerektap_ad_token";

/**
 * Код клика, который доедет до WhatsApp.
 *
 * Google отдаёт gclid только в адресе посадочной страницы. Семь заявок из
 * десяти оформляются в чате, куда адрес не переносится: человек нажимает
 * кнопку, открывается WhatsApp — и связь с объявлением обрывается. Именно
 * поэтому в Google Ads стоял ноль конверсий.
 *
 * Единственное, что доезжает из браузера в чат, — предзаполненный текст
 * сообщения. Сам gclid туда не вставить: он длинный и человек его увидит.
 * Поэтому меняем его на сервере на пятизначный код.
 *
 * Держим в памяти и в sessionStorage: человек может походить по страницам,
 * а второй запрос за кодом выдал бы второй код на тот же клик.
 */
let inMemory: string | null = null;
let pending: Promise<string | null> | null = null;

function cached(): string | null {
  if (inMemory) return inMemory;
  try {
    const stored = sessionStorage.getItem(KEY);
    if (stored) {
      inMemory = stored;
      return stored;
    }
  } catch {
    // Встроенный браузер или приватный режим — остаёмся на памяти страницы.
  }
  return null;
}

/**
 * Запросить код, если человек пришёл по рекламе.
 *
 * Возвращает null для всех остальных: без рекламного идентификатора метить
 * нечего, и лишний символ в тексте сообщения не нужен.
 *
 * Сетевая ошибка тоже даёт null — кнопка тогда работает как раньше, просто
 * без метки. Атрибуция важна нам, а не человеку, который хочет заказать.
 */
export async function adClickToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const ready = cached();
  if (ready) return ready;
  if (pending) return pending;

  const attribution = getAttribution();
  const params = attribution?.sourceParams ?? {};
  const clickId = params.gclid || params.yclid;
  if (!clickId) return null;

  pending = (async () => {
    try {
      const res = await fetch(`${API_URL}/analytics/ad-click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clickId,
          source: params.gclid ? "google" : "yandex",
          // Кампанию и объявление передаём, если реклама размечена вручную:
          // по gclid их видно только внутри Google, а в своём отчёте хочется
          // сразу знать, какое объявление принесло заявку.
          params: {
            ...(params.utm_campaign ? { utm_campaign: params.utm_campaign } : {}),
            ...(params.utm_term ? { utm_term: params.utm_term } : {}),
            ...(params.utm_content ? { utm_content: params.utm_content } : {}),
          },
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { token: string | null };
      if (!data.token) return null;
      inMemory = data.token;
      try {
        sessionStorage.setItem(KEY, data.token);
      } catch {
        // Память страницы переживает переходы внутри вкладки — этого хватает.
      }
      return data.token;
    } catch {
      return null;
    } finally {
      pending = null;
    }
  })();

  return pending;
}

/**
 * Дописать код к предзаполненному тексту.
 *
 * Отдельной строкой и в самом конце: так он не мешает боту разобрать заявку
 * и меньше бросается в глаза человеку, который в этот момент читает первую
 * строку, а не последнюю.
 */
export function withAdToken(text: string, token: string | null): string {
  return token ? `${text}\n#${token}` : text;
}
