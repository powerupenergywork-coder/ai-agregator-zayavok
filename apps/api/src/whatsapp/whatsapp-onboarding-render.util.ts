import { OutgoingWhatsAppMessage } from "./whatsapp-message-render.util";

// Token namespace for supplier onboarding, kept separate from the order
// flow's "cat|"/"fld|"/"action|" tokens:
//   "sup|toggle|<slug>" — add/remove a category from the running selection
//   "sup|done"          — finish category selection
//   "sup|urgent|true|false"
//   "sup|confirm" | "sup|restart"

export function renderCategoryMultiSelect(
  categories: { slug: string; name: string }[],
  selected: string[],
): OutgoingWhatsAppMessage {
  const items = categories.map((c) => ({
    token: `sup|toggle|${c.slug}`,
    label: `${selected.includes(c.slug) ? "✅ " : ""}${c.name}`,
  }));
  items.push({ token: "sup|done", label: "Готово" });

  const listText = items.map((it, idx) => `${idx + 1}. ${it.label}`).join("\n");
  const pendingOptions: Record<string, string> = {};
  items.forEach((it, idx) => (pendingOptions[String(idx + 1)] = it.token));

  return {
    body: `В каких категориях услуг вы работаете? Можно выбрать несколько — отмечайте по одной, потом «Готово».\n\n${listText}\n\nОтветьте номером.`,
    pendingOptions,
  };
}

export function renderYesNo(body: string, tokenPrefix: string): OutgoingWhatsAppMessage {
  return {
    body,
    buttons: [
      { id: `${tokenPrefix}|true`, text: "Да" },
      { id: `${tokenPrefix}|false`, text: "Нет" },
    ],
  };
}

export function renderOnboardingConfirm(
  collected: { companyName?: string; categorySlugs: string[]; cities: string[]; acceptsUrgent?: boolean },
  categories: { slug: string; name: string }[],
): OutgoingWhatsAppMessage {
  const categoryNames = collected.categorySlugs
    .map((slug) => categories.find((c) => c.slug === slug)?.name ?? slug)
    .join(", ");
  const body =
    `Проверьте данные:\n\n` +
    `Компания: ${collected.companyName ?? "—"}\n` +
    `Категории: ${categoryNames || "—"}\n` +
    `Города: ${collected.cities.join(", ") || "—"}\n` +
    `Срочные заказы: ${collected.acceptsUrgent ? "да" : "нет"}\n\n` +
    `Всё верно?`;
  return {
    body,
    buttons: [
      { id: "sup|confirm", text: "Подтвердить" },
      { id: "sup|restart", text: "Изменить" },
    ],
  };
}
