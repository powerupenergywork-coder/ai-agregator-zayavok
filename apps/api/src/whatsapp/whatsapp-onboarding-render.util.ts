import { Language, LocalizedText } from "@ai-zayavki/shared";
import { OutgoingWhatsAppMessage } from "./whatsapp-message-render.util";

// Token namespace for supplier onboarding, kept separate from the order
// flow's "cat|"/"fld|"/"action|" tokens:
//   "sup|cat|<slug>|true|false" — one category asked at a time, button tap
//   "sup|catnone" — «моей услуги в списке нет», выход из опроса категорий
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
/**
 * Третья кнопка — выход из опроса для тех, кого нет в списке.
 *
 * Без неё честный ответ «нет» на все шесть категорий приводит к «Нужно
 * выбрать хотя бы одну» и опрос начинается сначала — бесконечно. Реальный
 * случай: владелец минипогрузчика прошёл круг трижды, между кругами дважды
 * написал словами «У меня минипогрузчик» и оба раза получил «Ответьте
 * кнопкой выше». Человек говорит правду о себе, и за это его наказывают
 * бесконечным опросом.
 *
 * Кнопка нужна и нам: список того, что просят и чего у нас нет, — это
 * готовый ответ на вопрос, какую категорию заводить следующей.
 */
export function renderCategoryQuestion(category: { slug: string; name: LocalizedText }, lang: Language): OutgoingWhatsAppMessage {
  const body =
    lang === "kk" ? `«${category.name.kk}» қызметін ұсынасыз ба?` : `Вы предоставляете услугу «${category.name.ru}»?`;
  return {
    body,
    buttons: [
      { id: `sup|cat|${category.slug}|true`, text: lang === "kk" ? "Иә" : "Да" },
      { id: `sup|cat|${category.slug}|false`, text: lang === "kk" ? "Жоқ" : "Нет" },
      { id: "sup|catnone", text: lang === "kk" ? "Басқа" : "Другое" },
    ],
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
