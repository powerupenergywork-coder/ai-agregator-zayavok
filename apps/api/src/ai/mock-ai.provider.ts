import { Injectable } from "@nestjs/common";
import { CategoryField } from "@ai-zayavki/shared";
import { AiCategoryOption, AiProvider, ClassifyResult } from "./ai.types";
import { matchUnknownValueKeyword } from "./field-completion.util";
import { isoDateInTimezone, isoDatePlusDays } from "../common/local-date.util";

// Deterministic offline stand-in for the OpenAI provider — no network calls,
// so `AI_PROVIDER=mock` (the default) lets the whole order flow be exercised
// locally without an API key. Good enough to demo the golden path; real
// language understanding needs AI_PROVIDER=openai.

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  gazelle: ["газель", "переезд", "мебель", "вещи"],
  "dump-truck": ["самосвал", "грунт", "песок", "щебень"],
  "crane-truck": ["манипулятор", "бытовку", "бытовка"],
  crane: ["автокран", "подъёмный кран", "поднять груз", "монтаж", "демонтаж", "стрела крана", "кран"],
  "construction-waste": ["строительный мусор", "вывезти мусор", "мусор"],
  loaders: ["грузчик", "грузчики"],
  "aerial-platform": ["автовышка", "автовышку", "вышк", "люльк", "подъёмник", "подъемник"],
  "front-loader": ["фронтальный погрузчик", "погрузчик", "бобкэт", "бобкат", "bobcat"],
  disinfection: ["дезинфек", "дезинсек", "дератиз", "таракан", "клоп", "грызун", "потрав", "санобработ"],
};

/**
 * Слова, которые называют саму услугу или машину, — против слов о грузе.
 *
 * «Погрузчик загрузить грунт» — погрузчик грузит грунт в самосвал, и обе
 * категории получали по баллу: «погрузчик» технике, «грунт» самосвалу. При
 * ничьей побеждала первая по порядку из базы, и заявка уходила самосвальщикам.
 *
 * Человек назвал машину — это и есть ответ. Материал, вид работ и что грузим
 * лишь уточняют его, поэтому весят вдвое меньше.
 */
const STRONG_KEYWORDS = new Set([
  "газель",
  "самосвал",
  "манипулятор",
  "автокран",
  "подъёмный кран",
  "стрела крана",
  "кран",
  "строительный мусор",
  "грузчик",
  "грузчики",
  "автовышка",
  "автовышку",
  "вышк",
  "люльк",
  "подъёмник",
  "подъемник",
  "фронтальный погрузчик",
  "погрузчик",
  "бобкэт",
  "бобкат",
  "bobcat",
  "дезинфек",
  "дезинсек",
  "дератиз",
  "таракан",
  "клоп",
  "грызун",
]);

/** Буква — любая, включая казахские; \w и \b на кириллице не работают. */
const LETTER = /[a-zа-яёәғқңөұүһі]/i;

/**
 * Слово встречается в тексте — но не как хвост другого слова.
 *
 * Простое includes путало «погрузчик» с «грузчиком»: фраза «нужен фронтальный
 * погрузчик» давала балл и технике, и бригаде грузчиков, а при равном счёте
 * побеждала та категория, которая раньше пришла из базы. То есть исход
 * зависел от порядка строк в таблице.
 *
 * Границу проверяем только слева. Справа нельзя: «погрузчика», «тараканов»,
 * «вышку» — обычные словоформы, и именно ими люди пишут.
 */
function mentions(text: string, keyword: string): boolean {
  for (let from = 0; ; ) {
    const at = text.indexOf(keyword, from);
    if (at < 0) return false;
    if (at === 0 || !LETTER.test(text[at - 1])) return true;
    from = at + 1;
  }
}

@Injectable()
export class MockAiProvider implements AiProvider {
  async classify(message: string, categories: AiCategoryOption[]): Promise<ClassifyResult | null> {
    const text = message.toLowerCase();
    let best: { slug: string; score: number } | null = null;

    for (const category of categories) {
      const keywords = CATEGORY_KEYWORDS[category.slug] ?? [];
      let score = 0;
      for (const kw of keywords) {
        if (mentions(text, kw)) score += STRONG_KEYWORDS.has(kw) ? 2 : 1;
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { slug: category.slug, score };
      }
    }

    if (!best) return null;
    return { slug: best.slug, confidence: Math.min(0.6 + (best.score / 2) * 0.15, 0.95) };
  }

  async extractFields(
    message: string,
    fields: CategoryField[],
    knownFields: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const text = message.toLowerCase();
    const out: Record<string, unknown> = {};

    const missingTextFields = fields.filter((f) => f.type === "text" && knownFields[f.key] === undefined);

    for (const field of fields) {
      // An already-filled field can still be corrected ("не в 9 утра, а в
      // 12:00"), but only by the branches below that require an explicit
      // match in the text. The two branches that would otherwise swallow the
      // whole message — the unknown-keyword shortcut and free text — stay
      // limited to fields that are still empty.
      const known = knownFields[field.key] !== undefined;

      if (field.allowUnknown && !known) {
        const keyword = matchUnknownValueKeyword(text);
        if (keyword) {
          out[field.key] = keyword;
          continue;
        }
      }

      switch (field.type) {
        case "text": {
          // Free-text fields (e.g. "dimensions") have no chip UI on WhatsApp —
          // the whole reply IS the answer, as long as it's unambiguous which
          // field it's answering (only safe when exactly one is missing).
          if (!known && missingTextFields.length === 1 && message.trim().length > 0) {
            out[field.key] = message.trim();
          }
          break;
        }
        case "time": {
          const time = extractTime(text);
          if (time) out[field.key] = time;
          break;
        }
        case "date": {
          const date = extractDate(text);
          if (date) out[field.key] = date;
          break;
        }
        case "number": {
          const num = extractNumber(text, field.unit);
          if (num !== null) out[field.key] = num;
          break;
        }
        case "enum": {
          const match = field.options?.find((opt) => text.includes(opt.label.ru.toLowerCase()));
          if (match) out[field.key] = match.value;
          break;
        }
        case "boolean": {
          // Правило смотрит НА КАКОЕ поле отвечает, а не только на текст.
          //
          // Прогон 2 сентября: «Нужны грузчики на переезд» записало у
          // категории «Грузчики» поле «есть лифт: да». Про лифт человек не
          // говорил — сработало правило, писавшееся для «нужны ли грузчики»
          // у газели, а применялось оно к любому полю «да/нет». Исполнитель
          // приехал бы, рассчитывая на лифт, которого может не быть.
          const key = field.key.toLowerCase();
          const about = (re: RegExp) => re.test(key);
          if (about(/loader|gruzchik|грузчик/)) {
            if (/без грузчик/.test(text)) out[field.key] = false;
            else if (/с грузчик|нужны грузчик|нужен грузчик/.test(text)) out[field.key] = true;
          } else if (about(/elevator|lift|лифт/)) {
            if (/без лифта|нет лифта|лифта нет/.test(text)) out[field.key] = false;
            else if (/лифт есть|есть лифт|с лифтом/.test(text)) out[field.key] = true;
          }
          // Для прочих полей «да/нет» молчим: угаданное значение человек не
          // увидит в вопросе и не поправит, а исполнителю оно уедет как факт.
          break;
        }
        case "address": {
          const addr = extractAddress(text, field.key);
          if (addr) out[field.key] = addr;
          break;
        }
        default:
          break;
      }
    }

    return out;
  }

  /**
   * Без ключа намерение не угадываем.
   *
   * Мок существует, чтобы поток заказа работал офлайн, а не чтобы
   * притворяться пониманием. Вернуть здесь выдуманное намерение значит
   * увести человека не в ту ветку на локальной машине и получить расхождение
   * с продом там, где его труднее всего заметить. null = роутер ведёт себя
   * ровно как до появления этой функции.
   */
  async classifyIntent(): Promise<null> {
    return null;
  }
}

function extractTime(text: string): string | null {
  // "в 12:00", "к 9", "на 18 часов" — the hour is what people actually
  // type; a bare number is left alone so "2 тонны" is not read as 02:00.
  const withMinutes = text.match(/(\d{1,2})[:.](\d{2})/);
  if (withMinutes) {
    const h = Number(withMinutes[1]);
    const m = Number(withMinutes[2]);
    if (h < 24 && m < 60) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const hourOnly = text.match(/(?:в|к|на)\s+(\d{1,2})\s*(?:час|ч|утра|вечера|дня)?/);
  if (hourOnly) {
    const h = Number(hourOnly[1]);
    if (h < 24) return `${String(h).padStart(2, "0")}:00`;
  }
  return null;
}

function extractDate(text: string): string | null {
  const today = new Date();
  // «Послезавтра» проверяем ПЕРВЫМ: слово содержит «завтра», и при обратном
  // порядке послезавтрашняя заявка получала завтрашнюю дату.
  if (/послезавтра/.test(text)) return isoDatePlusDays(2);
  if (/сегодня/.test(text)) return isoDateInTimezone();
  if (/завтра/.test(text)) return isoDatePlusDays(1);
  const dmy = text.match(/(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y ? (y.length === 2 ? Number(`20${y}`) : Number(y)) : today.getFullYear();
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

function extractNumber(text: string, unit?: string): number | null {
  if (/не знаю/.test(text)) return null; // handled as "unknown" via explicit chip, not free text
  const unitPattern = unit
    ? new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:${escapeRegex(unit)})`, "i")
    : null;
  if (unitPattern) {
    const m = text.match(unitPattern);
    if (m) return Number(m[1].replace(",", "."));
  }
  const generic = text.match(/(\d+(?:[.,]\d+)?)\s*(кг|т|тонн|м3|м³|куб)/i);
  if (generic) return Number(generic[1].replace(",", "."));
  return null;
}

// Genitive/dative forms -> nominative, for the handful of KZ cities used in
// ТЗ examples. Real NLP (AI_PROVIDER=openai) normalizes this properly on its
// own; this table only exists to keep the offline mock demo-able end to end.
const CITY_NORMALIZATION: Record<string, string> = {
  "астаны": "Астана",
  "астане": "Астана",
  "астана": "Астана",
  "алматы": "Алматы",
  "косшы": "Косшы",
  "коши": "Косшы",
  "шымкента": "Шымкент",
  "шымкенте": "Шымкент",
  "шымкент": "Шымкент",
};

function extractAddress(text: string, fieldKey: string): string | null {
  const isFrom = /from|загруз/i.test(fieldKey);
  const pattern = isFrom ? /из\s+([а-яё\s]+?)(?:\sв\s|,|$)/i : /в\s+([а-яё\s]+?)(?:,|$)/i;
  const m = text.match(pattern);
  if (!m) return null;
  const raw = m[1].trim().toLowerCase();
  return CITY_NORMALIZATION[raw] ?? capitalize(raw);
}

// \w is ASCII-only in JS regex, so it silently no-ops on Cyrillic — match the
// Cyrillic + Latin lowercase ranges explicitly instead.
function capitalize(s: string): string {
  return s.replace(/(^|\s)([а-яёa-z])/g, (_m, boundary, ch) => boundary + ch.toUpperCase());
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
