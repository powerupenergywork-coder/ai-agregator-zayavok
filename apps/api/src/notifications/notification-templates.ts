// Template registry for events listed in ТЗ п.28. Each renders a short,
// single-purpose message — long descriptions stay on the web page the link
// points to (п.9.2 "не отправлять поставщику длинное описание"), except the
// supplier broadcast itself, which is the one message that needs everything
// (see order_broadcast_full below).

export type NotificationEvent =
  | "order_confirm_request"
  | "order_published"
  | "order_broadcast_full"
  | "order_cancelled"
  | "completion_checkin"
  | "complaint_received"
  | "needs_operator"
  | "quota_exceeded"
  | "subscription_activated";

const templates: Record<NotificationEvent, (p: any) => string> = {
  // Sent from the web flow before publishing actually happens — requires an
  // explicit tap on the attached button (or, with no WhatsApp, a fallback
  // SMS code) so a trusted-device session alone can't silently spam real
  // supplier notifications. See OrdersService.requestPublishConfirmation().
  order_confirm_request: (p) =>
    `Проверьте заявку №${p.orderNumber}\n${p.categoryName}, ${p.city}\n${p.whenText}\n\n${p.fullDescription}\n\nНажмите «Подтвердить», чтобы опубликовать и начать поиск исполнителей: ${p.confirmUrl}`,
  order_published: (p) =>
    `Заявка №${p.orderNumber} опубликована\n${p.categoryName}, ${p.city}\n${p.whenText}\n\n${p.fullDescription}\n\nМы начали поиск исполнителей. Статус: ${p.statusUrl}`,
  // Lead-broadcast model — no offer collection, so the message carries
  // everything a supplier needs to decide and call, including the client's
  // contact right away. WhatsApp auto-links the phone number for tap-to-call.
  order_broadcast_full: (p) =>
    `Новая заявка №${p.orderNumber}\n${p.categoryName}, ${p.city}\n${p.whenText}\n\n${p.fullDescription}\n\nТелефон клиента: ${p.clientPhone}\nПозвоните и договоритесь напрямую. Подробнее: ${p.orderUrl}`,
  order_cancelled: (p) => `Заявка №${p.orderNumber} отменена клиентом.`,
  // Proactive check-in — nobody in the system tracks which supplier the
  // client ended up going with, so we have to ask instead of waiting for
  // the client to come back and close the order themselves. WhatsApp gets
  // Да/Нет buttons attached (see OrdersService.sendCompletionCheckin); this
  // text is also the SMS/console fallback, hence the plain link.
  completion_checkin: (p) =>
    `Заявка №${p.orderNumber} (${p.categoryName}): удалось решить вопрос? Ответьте в WhatsApp или откройте заявку: ${p.orderUrl}`,
  complaint_received: (p) => `Жалоба по заявке №${p.orderNumber} требует проверки.`,
  needs_operator: (p) => `Заявка №${p.orderNumber} требует вмешательства оператора: ${p.reason}`,
  quota_exceeded: (p) =>
    `Бесплатный лимит заявок в этом месяце (${p.freeQuota}) исчерпан. Оформите подписку, чтобы продолжать получать заявки: ${p.paymentUrl}`,
  subscription_activated: (p) => `Подписка активирована на ${p.periodDays} дней. Спасибо!`,
};

export function renderTemplate(event: NotificationEvent, payload: Record<string, unknown>): string {
  return templates[event](payload);
}
