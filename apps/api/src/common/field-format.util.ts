import { CategoryField } from "@ai-zayavki/shared";

// Shared by the web-facing chip labels (whatsapp-message-render.util.ts) and
// the full-description supplier broadcast (matching-message.util.ts) so a
// value like "unknown" always reads as "не знаю" everywhere, not just on web.
export function formatFieldValue(value: unknown, field: CategoryField): string {
  if (value === "unknown") return "не знаю";
  if (value === "approximate") return "примерно";
  if (value === "needs_consultation") return "нужна консультация";
  if (field.type === "boolean") return value ? "да" : "нет";
  if (field.type === "enum") return field.options?.find((o) => o.value === value)?.label ?? String(value);
  return `${value}${field.unit ? ` ${field.unit}` : ""}`;
}
