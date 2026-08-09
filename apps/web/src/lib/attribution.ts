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

/**
 * Дубль в памяти страницы. Встроенный браузер Instagram может не дать доступ к
 * sessionStorage, и тогда атрибуция терялась молча: заявка №86 пришла вообще
 * без источника, хотя человек точно откуда-то пришёл. Память переживает
 * переходы внутри одной вкладки, а больше от неё и не требуется.
 */
let inMemory: Attribution | null = null;

/**
 * Реклама в Instagram и Facebook открывается во ВСТРОЕННОМ браузере
 * приложения, и он вырезает referrer. Если при этом в ссылке нет utm-меток,
 * источник определить нечем — заявка ложится как "direct", хотя пришла из
 * рекламы.
 * Ровно это и случилось с первыми двумя заявками после запуска.
 *
 * User-Agent такой браузер о себе сообщает честно. Сигнал слабее меток: он
 * говорит, из какого приложения человек пришёл, но не из какого объявления,
 * — поэтому проверяется последним, уже после utm и referrer.
 */
const IN_APP_BROWSERS: Array<[RegExp, string]> = [
  // Instagram — первым: его UA иногда несёт и признаки Facebook тоже.
  [/Instagram/i, "instagram"],
  [/FBAN|FBAV|FB_IAB/i, "facebook"],
  [/TikTok|BytedanceWebview/i, "tiktok"],
  [/WhatsApp/i, "whatsapp"],
  [/Telegram/i, "telegram"],
];

function detectInAppBrowser(): string | undefined {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (!ua) return undefined;
  for (const [re, name] of IN_APP_BROWSERS) {
    if (re.test(ua)) return name;
  }
  return undefined;
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
  if (inMemory) return; // первое касание уже записано в этой вкладке
  try {
    if (sessionStorage.getItem(KEY)) return;
  } catch {
    // sessionStorage недоступен — работаем только через память
  }

  try {
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

    // Последняя попытка перед тем, как записать "direct": человек мог прийти
    // из приложения, которое не оставляет ни меток, ни referrer.
    const inApp = source ? undefined : detectInAppBrowser();
    if (inApp) source = inApp;

    const attribution: Attribution = {
      source: source || "direct",
      sourceParams: {
        ...utm,
        // Помечаем догадку явно. Иначе через месяц не отличить заявку с
        // настроенными метками от той, где источник угадан по браузеру, — а
        // доверие к этим двум записям разное.
        ...(inApp ? { detected_by: "in_app_browser" } : {}),
      },
      landingPath: window.location.pathname,
    };
    if (Object.keys(attribution.sourceParams!).length === 0) delete attribution.sourceParams;

    inMemory = attribution;
    try {
      sessionStorage.setItem(KEY, JSON.stringify(attribution));
    } catch {
      // приватный режим или встроенный браузер — остаёмся на памяти
    }
  } catch {
    // атрибуция приятна, но не настолько, чтобы из-за неё падала форма заявки
  }
}

export function getAttribution(): Attribution {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Attribution;
  } catch {
    // читаем из памяти ниже
  }
  return inMemory ?? {};
}
