import { Language, LocalizedText } from "@ai-zayavki/shared";
import { OutgoingWhatsAppMessage } from "./whatsapp-message-render.util";

// Token namespace for supplier onboarding, kept separate from the order
// flow's "cat|"/"fld|"/"action|" tokens:
//   "sup|toggle|<slug>" — add/remove a category from the running selection
//   "sup|done"          — finish category selection
//   "sup|urgent|true|false"
//   "sup|confirm" | "sup|restart"

export function renderCategoryMultiSelect(
  categories: { slug: string; name: LocalizedText }[],
  selected: string[],
  lang: Language,
): OutgoingWhatsAppMessage {
  const items = categories.map((c) => ({
    token: `sup|toggle|${c.slug}`,
    label: `${selected.includes(c.slug) ? "✅ " : ""}${c.name[lang]}`,
  }));
  items.push({ token: "sup|done", label: lang === "kk" ? "Дайын" : "Готово" });

  const listText = items.map((it, idx) => `${idx + 1}. ${it.label}`).join("\n");
  const pendingOptions: Record<string, string> = {};
  items.forEach((it, idx) => (pendingOptions[String(idx + 1)] = it.token));

  const intro =
    lang === "kk"
      ? "Қандай қызмет санаттарында жұмыс істейсіз? Бірнешеуін таңдауға болады — бірден таңдап, содан кейін «Дайын» деп жазыңыз."
      : "В каких категориях услуг вы работаете? Можно выбрать несколько — отмечайте по одной, потом «Готово».";
  const hint = lang === "kk" ? "Нөмірмен жауап беріңіз." : "Ответьте номером.";

  return {
    body: `${intro}\n\n${listText}\n\n${hint}`,
    pendingOptions,
  };
}

export function renderYesNo(body: string, tokenPrefix: string, lang: Language): OutgoingWhatsAppMessage {
  return {
    body,
    buttons: [
      { id: `${tokenPrefix}|true`, text: lang === "kk" ? "Иә" : "Да" },
      { id: `${tokenPrefix}|false`, text: lang === "kk" ? "Жоқ" : "Нет" },
    ],
  };
}

export function renderOnboardingConfirm(
  collected: {
    companyName?: string;
    categorySlugs: string[];
    cities: string[];
    acceptsUrgent?: boolean;
    roundTheClock?: boolean;
  },
  categories: { slug: string; name: LocalizedText }[],
  lang: Language,
): OutgoingWhatsAppMessage {
  const categoryNames = collected.categorySlugs
    .map((slug) => categories.find((c) => c.slug === slug)?.name[lang] ?? slug)
    .join(", ");
  const body =
    lang === "kk"
      ? `Деректерді тексеріңіз:\n\n` +
        `Компания: ${collected.companyName ?? "—"}\n` +
        `Санаттар: ${categoryNames || "—"}\n` +
        `Қалалар: ${collected.cities.join(", ") || "—"}\n` +
        `Жедел тапсырыстар: ${collected.acceptsUrgent ? "иә" : "жоқ"}\n` +
        `Өтінімдер: ${collected.roundTheClock ? "тәулік бойы" : "тек жұмыс сағаттарында (08:00–21:00)"}\n\n` +
        `Бәрі дұрыс па?`
      : `Проверьте данные:\n\n` +
        `Компания: ${collected.companyName ?? "—"}\n` +
        `Категории: ${categoryNames || "—"}\n` +
        `Города: ${collected.cities.join(", ") || "—"}\n` +
        `Срочные заказы: ${collected.acceptsUrgent ? "да" : "нет"}\n` +
        `Заявки: ${collected.roundTheClock ? "круглосуточно" : "только в рабочие часы (08:00–21:00)"}\n\n` +
        `Всё верно?`;
  return {
    body,
    buttons: [
      { id: "sup|confirm", text: lang === "kk" ? "Растау" : "Подтвердить" },
      { id: "sup|restart", text: lang === "kk" ? "Өзгерту" : "Изменить" },
    ],
  };
}
