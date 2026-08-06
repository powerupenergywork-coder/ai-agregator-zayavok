/**
 * Откуда пришёл человек.
 *
 * Запоминаем при первом заходе и держим до конца сессии: заявка рождается не
 * сразу, человек успевает походить по страницам, и к моменту отправки метки
 * из адреса уже потеряны. Без фиксации «первого касания» заказ приписался бы
 * тому, на чём человек оказался последним, — обычно самому сайту.
 */

const KEY = "kerektap_attribution";

export interface Attribution {
  source?: string;
  sourceParams?: Record<string, string>;
  landingPath?: string;
}

/** Домены переходов, которые не значат ничего полезного. */
const SELF_HOSTS = ["kerektap.kz", "www.kerektap.kz", "localhost"];

/** Приводим к короткому набору каналов, иначе в отчёте будет каша из
 * "google.com", "www.google.kz", "com.google.android.googlequicksearchbox". */
function normalizeReferrer(host: string): string {
  const h = host.toLowerCase();
  if (h.includes("google")) return "google";
  if (h.includes("yandex")) return "yandex";
  if (h.includes("2gis")) return "2gis";
  if (h.includes("instagram")) return "instagram";
  if (h.includes("facebook") || h.includes("fb.")) return "facebook";
  if (h.includes("whatsapp") || h.includes("wa.me")) return "whatsapp";
  if (h.includes("t.me") || h.includes("telegram")) return "telegram";
  if (h.includes("olx")) return "olx";
  if (h.includes("kolesa") || h.includes("krisha")) return "kolesa";
  return h.replace(/^www\./, "");
}

/** Читает метки из адреса и домен перехода. Вызывать на первой загрузке. */
export function captureAttribution(): void {
  if (typeof window === "undefined") return;
  try {
    if (sessionStorage.getItem(KEY)) return; // первое касание уже записано

    const params = new URLSearchParams(window.location.search);
    const utm: Record<string, string> = {};
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "yclid"]) {
      const v = params.get(key);
      if (v) utm[key] = v.slice(0, 120);
    }

    let source = utm.utm_source;
    // gclid/yclid приходят без utm_source, когда объявление настроено на
    // автопометку — канал всё равно известен.
    if (!source && utm.gclid) source = "google";
    if (!source && utm.yclid) source = "yandex";

    if (!source && document.referrer) {
      try {
        const host = new URL(document.referrer).hostname;
        if (!SELF_HOSTS.includes(host)) source = normalizeReferrer(host);
      } catch {
        // мусорный referrer — просто игнорируем
      }
    }

    const attribution: Attribution = {
      source: source || "direct",
      sourceParams: Object.keys(utm).length > 0 ? utm : undefined,
      landingPath: window.location.pathname,
    };
    sessionStorage.setItem(KEY, JSON.stringify(attribution));
  } catch {
    // приватный режим браузера может запрещать sessionStorage — атрибуция
    // приятна, но не настолько, чтобы из-за неё падала форма заявки
  }
}

export function getAttribution(): Attribution {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Attribution) : {};
  } catch {
    return {};
  }
}
