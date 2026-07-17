import { CategoryField } from "@ai-zayavki/shared";
import { WhatsAppButton } from "./whatsapp-provider.interface";
import { OrderDto } from "../orders/order.dto";
import { formatFieldValue } from "../common/field-format.util";

// Mirrors the web chip UI (components/field-input.tsx) but for a chat
// medium: WhatsApp only allows 3 reply buttons per message (platform limit,
// confirmed against GREEN-API docs), so anything with more options falls
// back to a numbered text list — the reply parser (whatsapp-router.service.ts)
// accepts either a tapped button or a bare number typed against that list.
//
// Token format encoded into buttonId / list positions:
//   "cat|<slug>"        — category pick
//   "fld|<key>|<value>" — field answer
//   "action|publish" | "action|edit"

export interface OutgoingWhatsAppMessage {
  body: string;
  buttons?: WhatsAppButton[];
  /** Set only when we used a numbered list instead of buttons — position -> token. */
  pendingOptions?: Record<string, string>;
}

interface OptionItem {
  token: string;
  label: string;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildOptionItems(fields: CategoryField[]): OptionItem[] {
  const items: OptionItem[] = [];
  for (const f of fields) {
    if (f.type === "enum" && f.options) {
      for (const opt of f.options) items.push({ token: `fld|${f.key}|${opt.value}`, label: opt.label });
    } else if (f.type === "boolean") {
      items.push({ token: `fld|${f.key}|true`, label: "Да" });
      items.push({ token: `fld|${f.key}|false`, label: "Нет" });
    } else if (f.type === "date") {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfter = new Date(today);
      dayAfter.setDate(dayAfter.getDate() + 2);
      items.push({ token: `fld|${f.key}|${fmtDate(today)}`, label: "Сегодня" });
      items.push({ token: `fld|${f.key}|${fmtDate(tomorrow)}`, label: "Завтра" });
      items.push({ token: `fld|${f.key}|${fmtDate(dayAfter)}`, label: "Послезавтра" });
    } else if (f.type === "time") {
      for (const t of ["09:00", "12:00", "15:00", "18:00"]) {
        items.push({ token: `fld|${f.key}|${t}`, label: t });
      }
    }
    // text / number / address / photo — free text only, no chip items.
  }
  return items;
}

function asButtonsOrList(body: string, items: OptionItem[]): OutgoingWhatsAppMessage {
  if (items.length === 0) return { body };
  if (items.length <= 3) {
    return { body, buttons: items.map((i) => ({ id: i.token, text: i.label })) };
  }
  const listText = items.map((it, idx) => `${idx + 1}. ${it.label}`).join("\n");
  const pendingOptions: Record<string, string> = {};
  items.forEach((it, idx) => (pendingOptions[String(idx + 1)] = it.token));
  return { body: `${body}\n\n${listText}\n\nОтветьте номером или напишите свой вариант.`, pendingOptions };
}

export function renderFieldQuestion(fields: CategoryField[], assistantMessage: string): OutgoingWhatsAppMessage {
  const hasAllowUnknown = fields.some((f) => f.allowUnknown);
  const hint = hasAllowUnknown
    ? "\n\nЕсли не знаете точно — напишите «не знаю», «примерно» или «нужна консультация»."
    : "";
  return asButtonsOrList(assistantMessage + hint, buildOptionItems(fields));
}

export function renderCategoryPick(categories: { slug: string; name: string }[]): OutgoingWhatsAppMessage {
  const items = categories.map((c) => ({ token: `cat|${c.slug}`, label: c.name }));
  return asButtonsOrList("Не получилось точно определить категорию. Выберите подходящий вариант:", items);
}

export function renderReviewCard(order: OrderDto): OutgoingWhatsAppMessage {
  const lines = (order.category?.fields ?? [])
    .filter((f) => order.fieldsData[f.key] !== undefined)
    .map((f) => `${f.label}: ${formatFieldValue(order.fieldsData[f.key], f)}`);
  return {
    body: `Проверьте заявку:\n\n${lines.join("\n")}\n\nВсё верно?`,
    buttons: [
      { id: "action|publish", text: "Отправить заявку" },
      { id: "action|edit", text: "Изменить" },
    ],
  };
}

