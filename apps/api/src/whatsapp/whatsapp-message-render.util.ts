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
  for (const f of fields) {
    if (f.type === "enum" && f.options) {
      for (const opt of f.options) items.push({ token: `fld|${f.key}|${opt.value}`, label: opt.label[lang] });
    } else if (f.type === "boolean") {
      items.push({ token: `fld|${f.key}|true`, label: yes });
      items.push({ token: `fld|${f.key}|false`, label: no });
    } else if (f.type === "date") {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfter = new Date(now);
      dayAfter.setDate(dayAfter.getDate() + 2);
      items.push({ token: `fld|${f.key}|${fmtDate(now)}`, label: today });
      items.push({ token: `fld|${f.key}|${fmtDate(tomorrow)}`, label: tomorrowLabel });
      items.push({ token: `fld|${f.key}|${fmtDate(dayAfter)}`, label: dayAfterLabel });
    } else if (f.type === "time") {
      for (const t of ["09:00", "12:00", "15:00", "18:00"]) {
        items.push({ token: `fld|${f.key}|${t}`, label: t });
      }
    }
    // text / number / address / photo — free text only, no chip items.
  }
  return items;
}

function asButtonsOrList(body: string, items: OptionItem[], lang: Language): OutgoingWhatsAppMessage {
  if (items.length === 0) return { body };
  if (items.length <= 3) {
    return { body, buttons: items.map((i) => ({ id: i.token, text: i.label })) };
  }
  const listText = items.map((it, idx) => `${idx + 1}. ${it.label}`).join("\n");
  const pendingOptions: Record<string, string> = {};
  items.forEach((it, idx) => (pendingOptions[String(idx + 1)] = it.token));
  const hint = lang === "kk" ? "Нөмірмен жауап беріңіз немесе өз нұсқаңызды жазыңыз." : "Ответьте номером или напишите свой вариант.";
  return { body: `${body}\n\n${listText}\n\n${hint}`, pendingOptions };
}

/** A representative example value per field type, used only to build the
 * "например: ..." template for combined (combineGroup) questions below —
 * never sent as real data. */
function exampleValueForField(field: CategoryField, lang: Language): string {
  switch (field.type) {
    case "date":
      return lang === "kk" ? "ертең" : "завтра";
    case "time":
      return "12:00";
    case "address":
      return lang === "kk" ? "Абай көш. 10" : "ул. Абая 10";
    case "number":
      return field.unit ? `3 ${field.unit}` : "3";
    case "boolean":
      return lang === "kk" ? "иә" : "да";
    case "enum":
      return field.options?.[0]?.label[lang] ?? (lang === "kk" ? "нұсқа" : "вариант");
    default:
      return lang === "kk" ? "қалауыңызша" : "как вам удобно";
  }
}

export function renderFieldQuestion(fields: CategoryField[], assistantMessage: string, lang: Language): OutgoingWhatsAppMessage {
  const hasAllowUnknown = fields.some((f) => f.allowUnknown);
  const unknownHint = hasAllowUnknown
    ? lang === "kk"
      ? "\n\nНақты білмесеңіз — «білмеймін», «шамамен» немесе «орындаушының кеңесі керек» деп жазыңыз."
      : "\n\nЕсли не знаете точно — напишите «не знаю», «примерно» или «нужна консультация»."
    : "";

  // A combineGroup batch (nextQuestionFields returning >1 field, e.g. date +
  // time, or two addresses) asks about several fields in one message.
  // Chips/numbered options built per-field used to get flattened into one
  // undifferentiated list — a client couldn't tell whether a time slot like
  // "15:00" was answering "today" or "tomorrow", since only one flat number
  // is answerable at a time anyway. A filled-in text example is unambiguous
  // and lets the client answer everything in one message besides.
  if (fields.length > 1) {
    const example = fields.map((f) => `${f.label[lang]}: ${exampleValueForField(f, lang)}`).join(", ");
    const templateHint =
      lang === "kk"
        ? `\n\nЖауапты бір хабарламамен мәтінмен жазыңыз, мысалы: «${example}».`
        : `\n\nНапишите ответ одним сообщением текстом, например: «${example}».`;
    return { body: assistantMessage + unknownHint + templateHint };
  }

  return asButtonsOrList(assistantMessage + unknownHint, buildOptionItems(fields, lang), lang);
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
