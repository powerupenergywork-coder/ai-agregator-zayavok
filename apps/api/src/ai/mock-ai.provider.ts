import { Injectable } from "@nestjs/common";
import { CategoryField } from "@ai-zayavki/shared";
import { AiCategoryOption, AiProvider, ClassifyResult } from "./ai.types";
import { matchUnknownValueKeyword } from "./field-completion.util";

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
};

@Injectable()
export class MockAiProvider implements AiProvider {
  async classify(message: string, categories: AiCategoryOption[]): Promise<ClassifyResult | null> {
    const text = message.toLowerCase();
    let best: { slug: string; score: number } | null = null;

    for (const category of categories) {
      const keywords = CATEGORY_KEYWORDS[category.slug] ?? [];
      let score = 0;
      for (const kw of keywords) {
        if (text.includes(kw)) score += 1;
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { slug: category.slug, score };
      }
    }

    if (!best) return null;
    return { slug: best.slug, confidence: Math.min(0.6 + best.score * 0.15, 0.95) };
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
      if (knownFields[field.key] !== undefined) continue;

      if (field.allowUnknown) {
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
          if (missingTextFields.length === 1 && message.trim().length > 0) {
            out[field.key] = message.trim();
          }
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
          if (/без грузчик/.test(text)) out[field.key] = false;
          else if (/с грузчик|нужны грузчик|лифт есть|есть лифт/.test(text)) out[field.key] = true;
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
}

function extractDate(text: string): string | null {
  const today = new Date();
  if (/сегодня/.test(text)) return today.toISOString().slice(0, 10);
  if (/завтра/.test(text)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (/послезавтра/.test(text)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
  }
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
