import { CategoryField } from "@ai-zayavki/shared";

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
