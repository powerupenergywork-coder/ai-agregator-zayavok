import { Language, LocalizedText } from "@ai-zayavki/shared";
import { OutgoingWhatsAppMessage } from "./whatsapp-message-render.util";

// Token namespace for supplier onboarding, kept separate from the order
// flow's "cat|"/"fld|"/"action|" tokens:
//   "sup|cat|<slug>|true|false" — one category asked at a time, button tap
//   "sup|urgent|true|false"
//   "sup|hours|true|false"
//   "sup|confirm" | "sup|restart"
//
// Categories used to be a single numbered text list the supplier had to
// retype digits against — replaced with one Yes/No button question per
// category (see WhatsAppOnboardingService.askNextCategory) so the whole
// registration is tap-only, matching how urgent/hours already worked. A
// numbered list is still unavoidable for >3 options elsewhere (e.g. the
// order flow's field chips), but category selection never needs more than
// two buttons per message this way.
export function renderCategoryQuestion(category: { slug: string; name: LocalizedText }, lang: Language): OutgoingWhatsAppMessage {
  const body =
    lang === "kk" ? `«${category.name.kk}» қызметін ұсынасыз ба?` : `Вы предоставляете услугу «${category.name.ru}»?`;
  return renderYesNo(body, `sup|cat|${category.slug}`, lang);
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
