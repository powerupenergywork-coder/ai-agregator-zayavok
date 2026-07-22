// Template registry for events listed in ТЗ п.28. Each renders a short,
// single-purpose message — long descriptions stay on the web page the link
// points to (п.9.2 "не отправлять поставщику длинное описание"), except the
// supplier broadcast itself, which is the one message that needs everything
// (see order_broadcast_full below).
//
// Every template is bilingual — see packages/shared/src/language.ts. The
// caller resolves the recipient's language (User.preferredLanguage) and
// passes it to renderTemplate().

import { Language } from "@ai-zayavki/shared";

export type NotificationEvent =
  | "order_confirm_request"
  | "order_published"
  | "order_broadcast_full"
  | "order_digest"
  | "order_cancelled"
  | "completion_checkin"
  | "complaint_received"
  | "needs_operator"
  | "quota_exceeded"
  | "subscription_activated"
  | "prospect_outreach";

const templates: Record<NotificationEvent, (p: any, lang: Language) => string> = {
  // Sent from the web flow before publishing actually happens — requires an
  // explicit tap on the attached button (or, with no WhatsApp, a fallback
  // SMS code) so a trusted-device session alone can't silently spam real
  // supplier notifications. See OrdersService.requestPublishConfirmation().
  order_confirm_request: (p, lang) =>
    lang === "kk"
      ? `Өтінім №${p.orderNumber} тексеріңіз\n${p.categoryName}, ${p.city}\n${p.whenText}\n\n${p.fullDescription}\n\nЖариялап, орындаушыларды іздей бастау үшін «Растау» батырмасын басыңыз: ${p.confirmUrl}`
      : `Проверьте заявку №${p.orderNumber}\n${p.categoryName}, ${p.city}\n${p.whenText}\n\n${p.fullDescription}\n\nНажмите «Подтвердить», чтобы опубликовать и начать поиск исполнителей: ${p.confirmUrl}`,
  order_published: (p, lang) =>
    lang === "kk"
      ? `Өтінім №${p.orderNumber} жарияланды\n${p.categoryName}, ${p.city}\n${p.whenText}\n\n${p.fullDescription}\n\nОрындаушыларды іздей бастадық. Мәртебе: ${p.statusUrl}`
      : `Заявка №${p.orderNumber} опубликована\n${p.categoryName}, ${p.city}\n${p.whenText}\n\n${p.fullDescription}\n\nМы начали поиск исполнителей. Статус: ${p.statusUrl}`,
  // Lead-broadcast model — no offer collection, so the message carries
  // everything a supplier needs to decide and call, including the client's
  // contact right away. WhatsApp auto-links the phone number for tap-to-call.
  order_broadcast_full: (p, lang) =>
    lang === "kk"
      ? `Жаңа өтінім №${p.orderNumber}\n${p.categoryName}, ${p.city}\n${p.whenText}\n\n${p.fullDescription}\n\nКлиенттің телефоны: ${p.clientPhone}\nҚоңырау шалып, тікелей келісіңіз. Толығырақ: ${p.orderUrl}`
      : `Новая заявка №${p.orderNumber}\n${p.categoryName}, ${p.city}\n${p.whenText}\n\n${p.fullDescription}\n\nТелефон клиента: ${p.clientPhone}\nПозвоните и договоритесь напрямую. Подробнее: ${p.orderUrl}`,
  // Batched replacement for order_broadcast_full when orders arrived during
  // the supplier's quiet hours — one message instead of one ping per order.
  // See MatchingService.flushPendingDigests(). Same self-contained content
  // per order (client phone included) as the real-time broadcast.
  order_digest: (p, lang) => {
    const orders = p.orders as Array<{
      orderNumber: number;
      categoryName: string;
      city: string;
      whenText: string;
      fullDescription: string;
      clientPhone: string;
      orderUrl: string;
    }>;
    const blocks = orders.map((o) =>
      lang === "kk"
        ? `Өтінім №${o.orderNumber}\n${o.categoryName}, ${o.city}\n${o.whenText}\n\n${o.fullDescription}\n\nКлиенттің телефоны: ${o.clientPhone}\nТолығырақ: ${o.orderUrl}`
        : `Заявка №${o.orderNumber}\n${o.categoryName}, ${o.city}\n${o.whenText}\n\n${o.fullDescription}\n\nТелефон клиента: ${o.clientPhone}\nПодробнее: ${o.orderUrl}`,
    );
    const header =
      lang === "kk"
        ? orders.length === 1
          ? "Сіз демалып жатқанда жаңа өтінім келді:"
          : `Сіз демалып жатқанда келген жаңа өтінімдер саны: ${orders.length}`
        : orders.length === 1
          ? "Пока вы отдыхали, пришла новая заявка:"
          : `Пока вы отдыхали, пришло новых заявок: ${orders.length}`;
    return `${header}\n\n${blocks.join("\n\n---\n\n")}`;
  },
  order_cancelled: (p, lang) =>
    lang === "kk" ? `Өтінім №${p.orderNumber} клиент тарапынан бас тартылды.` : `Заявка №${p.orderNumber} отменена клиентом.`,
  // Proactive check-in — nobody in the system tracks which supplier the
  // client ended up going with, so we have to ask instead of waiting for
  // the client to come back and close the order themselves. WhatsApp gets
  // Да/Нет buttons attached (see OrdersService.sendCompletionCheckin); this
  // text is also the SMS/console fallback, hence the plain link.
  completion_checkin: (p, lang) =>
    lang === "kk"
      ? `Өтінім №${p.orderNumber} (${p.categoryName}): мәселе шешілді ме? WhatsApp-та жауап беріңіз немесе өтінімді ашыңыз: ${p.orderUrl}`
      : `Заявка №${p.orderNumber} (${p.categoryName}): удалось решить вопрос? Ответьте в WhatsApp или откройте заявку: ${p.orderUrl}`,
  complaint_received: (p, lang) =>
    lang === "kk" ? `№${p.orderNumber} өтінімі бойынша шағым тексеруді қажет етеді.` : `Жалоба по заявке №${p.orderNumber} требует проверки.`,
  needs_operator: (p, lang) =>
    lang === "kk"
      ? `№${p.orderNumber} өтінімі операторың араласуын қажет етеді: ${p.reason}`
      : `Заявка №${p.orderNumber} требует вмешательства оператора: ${p.reason}`,
  quota_exceeded: (p, lang) =>
    lang === "kk"
      ? `Осы айдағы тегін өтінім лимиті (${p.freeQuota}) таусылды. Өтінімдерді алуды жалғастыру үшін жазылым рәсімдеңіз: ${p.paymentUrl}`
      : `Бесплатный лимит заявок в этом месяце (${p.freeQuota}) исчерпан. Оформите подписку, чтобы продолжать получать заявки: ${p.paymentUrl}`,
  subscription_activated: (p, lang) =>
    lang === "kk" ? `Жазылым ${p.periodDays} күнге белсендірілді. Рахмет!` : `Подписка активирована на ${p.periodDays} дней. Спасибо!`,
  // Cold outreach to a phone that has never messaged the bot — we don't yet
  // know their language, so unlike every other template this one ignores
  // `lang` and always renders both blocks. See whatsapp-templates.ts for the
  // matching Meta template registration (one combined template, two
  // quick-reply buttons — the tapped button is what actually picks the
  // language going forward). This plain-text version is only used for the
  // NotificationLog entry; the real send always goes through sendTemplate()
  // since a brand-new phone's 24h window is never open.
  prospect_outreach: (p) =>
    `Здравствуйте! \u{1F44B}\nЭто AI-агрегатор заявок на услуги в Казахстане.\nПрямо сейчас в вашем городе ищут исполнителя:\n\u{1F4E6} ${p.categoryRu}   \u{1F4CD} ${p.city}   \u{1F4DD} ${p.summaryRu}\n\n—\n\nСәлеметсіз бе! \u{1F44B}\nБұл — Қазақстандағы қызмет көрсету өтінімдерінің AI-агрегаторы.\nДәл қазір сіздің қалаңызда орындаушы іздеп жатыр:\n\u{1F4E6} ${p.categoryKk}   \u{1F4CD} ${p.city}   \u{1F4DD} ${p.summaryKk}`,
};

export function renderTemplate(event: NotificationEvent, payload: Record<string, unknown>, lang: Language): string {
  return templates[event](payload, lang);
}
