import { CategoryField, Language } from "@ai-zayavki/shared";

// Shared by the web-facing chip labels (whatsapp-message-render.util.ts) and
// the full-description supplier broadcast (matching-message.util.ts) so a
// value like "unknown" always reads as "не знаю"/"білмеймін" everywhere, not
// just on web.
export function formatFieldValue(value: unknown, field: CategoryField, lang: Language): string {
  if (value === "unknown") return lang === "kk" ? "білмеймін" : "не знаю";
  if (value === "approximate") return lang === "kk" ? "шамамен" : "примерно";
  if (value === "needs_consultation") return lang === "kk" ? "орындаушының кеңесі керек" : "нужна консультация";
  if (field.type === "boolean") return value ? (lang === "kk" ? "иә" : "да") : lang === "kk" ? "жоқ" : "нет";
  if (field.type === "enum") return field.options?.find((o) => o.value === value)?.label[lang] ?? String(value);
  return `${value}${field.unit ? ` ${field.unit}` : ""}`;
}
