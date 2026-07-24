import { CategoryField, Language } from "@ai-zayavki/shared";
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
  /** Set when items come from a combineGroup batch (see nextQuestionFields) —
   * so a combined question like "date + time" can render as two visually
   * separated sub-lists instead of one undifferentiated 1..7 list where it's
   * unclear which options answer which half of the question. */
  groupLabel?: string;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildOptionItems(fields: CategoryField[], lang: Language): OptionItem[] {
  const items: OptionItem[] = [];
  const yes = lang === "kk" ? "Иә" : "Да";
  const no = lang === "kk" ? "Жоқ" : "Нет";
  const today = lang === "kk" ? "Бүгін" : "Сегодня";
  const tomorrowLabel = lang === "kk" ? "Ертең" : "Завтра";
  const dayAfterLabel = lang === "kk" ? "Арғы күні" : "Послезавтра";
  // Only tag items with which field they belong to when the question actually
  // bundles more than one field (a combineGroup batch, e.g. date + time) —
  // a single-field question has nothing to disambiguate, so leave it as a
  // plain list rather than adding a redundant one-line header.
  const groupLabel = fields.length > 1 ? (f: CategoryField) => f.label[lang] : () => undefined;
  for (const f of fields) {
    const group = groupLabel(f);
    if (f.type === "enum" && f.options) {
      for (const opt of f.options) items.push({ token: `fld|${f.key}|${opt.value}`, label: opt.label[lang], groupLabel: group });
    } else if (f.type === "boolean") {
      items.push({ token: `fld|${f.key}|true`, label: yes, groupLabel: group });
      items.push({ token: `fld|${f.key}|false`, label: no, groupLabel: group });
    } else if (f.type === "date") {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfter = new Date(now);
      dayAfter.setDate(dayAfter.getDate() + 2);
      items.push({ token: `fld|${f.key}|${fmtDate(now)}`, label: today, groupLabel: group });
      items.push({ token: `fld|${f.key}|${fmtDate(tomorrow)}`, label: tomorrowLabel, groupLabel: group });
      items.push({ token: `fld|${f.key}|${fmtDate(dayAfter)}`, label: dayAfterLabel, groupLabel: group });
    } else if (f.type === "time") {
      for (const t of ["09:00", "12:00", "15:00", "18:00"]) {
        items.push({ token: `fld|${f.key}|${t}`, label: t, groupLabel: group });
      }
    }
    // text / number / address / photo — free text only, no chip items.
  }
  return items;
}

function asButtonsOrList(body: string, items: OptionItem[], lang: Language): OutgoingWhatsAppMessage {
  if (items.length === 0) return { body };
  if (items.length <= 3 && !items.some((i) => i.groupLabel)) {
    return { body, buttons: items.map((i) => ({ id: i.token, text: i.label })) };
  }
  // Group consecutive items sharing a groupLabel under their own heading
  // (e.g. "Дата:" / "Время:") so a combined-field question never reads as
  // one undifferentiated list — numbering stays sequential across groups
  // since pendingOptions keys off the flat position, not the group.
  const lines: string[] = [];
  let lastGroup: string | undefined | null = null;
  items.forEach((it, idx) => {
    if (it.groupLabel && it.groupLabel !== lastGroup) {
      if (lines.length > 0) lines.push("");
      lines.push(`${it.groupLabel}:`);
    }
    lastGroup = it.groupLabel ?? null;
    lines.push(`${idx + 1}. ${it.label}`);
  });
  const pendingOptions: Record<string, string> = {};
  items.forEach((it, idx) => (pendingOptions[String(idx + 1)] = it.token));
  const hint =
    items.some((i) => i.groupLabel)
      ? lang === "kk"
        ? "Бір нөмірмен жауап берсеңіз — сол бойынша нақтылап, қалғанын жеке сұраймыз. Немесе екеуін бірден мәтінмен жазыңыз."
        : "Один номер — ответит только на один пункт, про второй переспросим отдельно. Либо сразу напишите оба ответа текстом."
      : lang === "kk"
        ? "Нөмірмен жауап беріңіз немесе өз нұсқаңызды жазыңыз."
        : "Ответьте номером или напишите свой вариант.";
  return { body: `${body}\n\n${lines.join("\n")}\n\n${hint}`, pendingOptions };
}

export function renderFieldQuestion(fields: CategoryField[], assistantMessage: string, lang: Language): OutgoingWhatsAppMessage {
  const hasAllowUnknown = fields.some((f) => f.allowUnknown);
  const hint = hasAllowUnknown
    ? lang === "kk"
      ? "\n\nНақты білмесеңіз — «білмеймін», «шамамен» немесе «орындаушының кеңесі керек» деп жазыңыз."
      : "\n\nЕсли не знаете точно — напишите «не знаю», «примерно» или «нужна консультация»."
    : "";
  return asButtonsOrList(assistantMessage + hint, buildOptionItems(fields, lang), lang);
}

export function renderCategoryPick(categories: { slug: string; name: string }[], lang: Language): OutgoingWhatsAppMessage {
  const items = categories.map((c) => ({ token: `cat|${c.slug}`, label: c.name }));
  const body =
    lang === "kk"
      ? "Санатты дәл анықтай алмадық. Сәйкес нұсқаны таңдаңыз:"
      : "Не получилось точно определить категорию. Выберите подходящий вариант:";
  return asButtonsOrList(body, items, lang);
}

export function renderReviewCard(order: OrderDto, lang: Language): OutgoingWhatsAppMessage {
  const lines = (order.category?.fields ?? [])
    .filter((f) => order.fieldsData[f.key] !== undefined)
    .map((f) => `${f.label[lang]}: ${formatFieldValue(order.fieldsData[f.key], f, lang)}`);
  const body =
    lang === "kk"
      ? `Өтінімді тексеріңіз:\n\n${lines.join("\n")}\n\nБәрі дұрыс па?`
      : `Проверьте заявку:\n\n${lines.join("\n")}\n\nВсё верно?`;
  return {
    body,
    buttons: [
      { id: "action|publish", text: lang === "kk" ? "Өтінімді жіберу" : "Отправить заявку" },
      { id: "action|edit", text: lang === "kk" ? "Өзгерту" : "Изменить" },
    ],
  };
}
