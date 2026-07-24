import { CategoryField, UNKNOWN_VALUE_OPTIONS } from "@ai-zayavki/shared";

const UNKNOWN_VALUES = new Set(UNKNOWN_VALUE_OPTIONS.map((o) => o.value));

/** Cheap deterministic fallback for allowUnknown fields (see ТЗ п.4.4) when AI
 * extraction is unavailable or doesn't map the client's phrasing to one of the
 * three special values — keyed on the same RU/KK words the field's own hint
 * text (whatsapp-message-render.util.ts renderFieldQuestion) tells the client
 * to use, so an exact-phrase reply always makes progress even without a
 * working AI provider. Order matters: "нужна консультация" contains "нужна",
 * check the more specific consultation/approximate phrases before the bare
 * "не знаю" catch-all. */
export function matchUnknownValueKeyword(text: string): string | undefined {
  const t = text.toLowerCase();
  if (/консультац|кеңес/.test(t)) return "needs_consultation";
  if (/примерно|шамамен/.test(t)) return "approximate";
  if (/не знаю|білмеймін/.test(t)) return "unknown";
  return undefined;
}

/** Guards against a value that doesn't match its field's declared type —
 * reachable both from direct API calls and from AI extraction (an LLM isn't
 * guaranteed to return a clean number for a "number" field just because the
 * prompt asked for one). Callers decide what to do with an invalid value:
 * setField() rejects it outright, chat-driven extraction just drops it so
 * the question gets asked again. */
export function isValidFieldValue(field: CategoryField, value: unknown): boolean {
  if (typeof value === "string" && UNKNOWN_VALUES.has(value)) return true;
  switch (field.type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "date":
      return typeof value === "string" && !Number.isNaN(Date.parse(value));
    case "time":
      return typeof value === "string" && /^\d{1,2}:\d{2}$/.test(value);
    case "enum":
      return typeof value === "string" && (field.options?.some((o) => o.value === value) ?? false);
    default:
      return typeof value === "string" && value.trim().length > 0;
  }
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Drops date/time values that already point at the past — a client
 * picking "Сегодня" from a stale button, or an AI extraction of "вчера",
 * would otherwise silently create an order for a moment that's already
 * gone. Date and its combineGroup-paired time are checked together: a date
 * before today is rejected outright; a date of exactly today is fine on
 * its own; only once we also have a same-day time value does that value
 * get checked against the actual clock. Returns which keys got dropped so
 * the caller can tell the client why, instead of just silently re-asking
 * the same question. */
export function dropPastDateTimeFields(
  fields: CategoryField[],
  values: Record<string, unknown>,
): { values: Record<string, unknown>; droppedPast: string[] } {
  const now = new Date();
  const today = startOfDay(now);
  const result = { ...values };
  const droppedPast: string[] = [];

  for (const field of fields) {
    if (field.type !== "date" || result[field.key] === undefined) continue;
    const raw = result[field.key];
    if (typeof raw !== "string") continue;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) continue;
    const day = startOfDay(parsed);

    if (day < today) {
      delete result[field.key];
      droppedPast.push(field.key);
      continue;
    }
    if (day.getTime() === today.getTime() && field.combineGroup) {
      const timeField = fields.find((f) => f.type === "time" && f.combineGroup === field.combineGroup);
      const timeValue = timeField ? result[timeField.key] : undefined;
      if (timeField && typeof timeValue === "string") {
        const [h, m] = timeValue.split(":").map(Number);
        const candidate = new Date(today);
        candidate.setHours(h, m, 0, 0);
        if (candidate < now) {
          delete result[timeField.key];
          droppedPast.push(timeField.key);
        }
      }
    }
  }

  return { values: result, droppedPast };
}

export function isFieldFilled(field: CategoryField, knownFields: Record<string, unknown>): boolean {
  const v = knownFields[field.key];
  if (v === undefined || v === null) return false;
  if (typeof v === "string" && v.trim() === "") return false;
  return true;
}

export function missingRequiredFields(
  fields: CategoryField[],
  knownFields: Record<string, unknown>,
): CategoryField[] {
  return fields.filter((f) => f.required && !isFieldFilled(f, knownFields));
}

/**
 * Picks what to ask next: at most 2 fields, and only bundles them together
 * when they share a combineGroup (e.g. loading + unloading address) — see
 * ТЗ п.4.2 "не более двух вопросов... допускается объединение связанных".
 */
export function nextQuestionFields(
  fields: CategoryField[],
  knownFields: Record<string, unknown>,
): CategoryField[] {
  const missing = missingRequiredFields(fields, knownFields);
  if (missing.length === 0) return [];
  const first = missing[0];
  if (!first.combineGroup) return [first];
  const grouped = missing.filter((f) => f.combineGroup === first.combineGroup).slice(0, 2);
  return grouped;
}

export function calculateProgressPercent(
  fields: CategoryField[],
  knownFields: Record<string, unknown>,
): number {
  const required = fields.filter((f) => f.required);
  if (required.length === 0) return 100;
  const filled = required.filter((f) => isFieldFilled(f, knownFields)).length;
  return Math.round((filled / required.length) * 100);
}
