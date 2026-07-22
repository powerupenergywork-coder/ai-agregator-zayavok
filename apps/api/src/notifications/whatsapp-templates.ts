// Meta Cloud API template registry for the notification events that can
// legitimately fire outside the recipient's 24h customer-service window
// (business-initiated, not a reply to something the recipient just sent):
// suppliers rarely message the bot proactively, so order_broadcast_full and
// order_digest are almost always at risk; completion_checkin fires exactly
// ORDER_CHECKIN_DELAY_HOURS after publish, likely after the window closed
// too. See NotificationsService.send() for where this gets used.
//
// Template *names* here must exactly match what's registered (and approved)
// in Meta Business Manager — see the project chat history for the exact
// body text to submit there. Body param order must match each approved
// template's {{1}}, {{2}}... placeholders exactly; button labels are fixed
// at template-approval time, only the quick-reply payload is dynamic here.

import { Language } from "@ai-zayavki/shared";
import { NotificationEvent } from "./notification-templates";

export const WHATSAPP_TEMPLATE_EVENTS = ["order_broadcast_full", "order_digest", "completion_checkin", "prospect_outreach"] as const;
export type WhatsAppTemplateEvent = (typeof WHATSAPP_TEMPLATE_EVENTS)[number];

export function isWhatsAppTemplateEvent(event: NotificationEvent): event is WhatsAppTemplateEvent {
  return (WHATSAPP_TEMPLATE_EVENTS as readonly string[]).includes(event);
}

const TEMPLATE_NAMES: Record<WhatsAppTemplateEvent, Record<Language, string>> = {
  order_broadcast_full: { ru: "order_broadcast_full_ru", kk: "order_broadcast_full_kk" },
  order_digest: { ru: "order_digest_ru", kk: "order_digest_kk" },
  completion_checkin: { ru: "completion_checkin_ru", kk: "completion_checkin_kk" },
  // One combined bilingual template (not split ru/kk) — see ТЗ_прогрев_поставщиков_v2
  // раздел 5: the recipient's language isn't known yet, so both language
  // blocks ship in one message and the tapped quick-reply button picks it.
  prospect_outreach: { ru: "prospect_outreach", kk: "prospect_outreach" },
};

export function whatsappTemplateName(event: WhatsAppTemplateEvent, lang: Language): string {
  return TEMPLATE_NAMES[event][lang];
}

/** Builds the {{1}}, {{2}}... body params in the exact order each approved
 * template expects — must stay in sync with the template text submitted to
 * Meta. order_digest's fixed-shape template can't loop over a variable
 * number of orders, so the fallback intentionally shows only the most
 * recent order's essentials + a total count; full per-order detail is still
 * what free text sends whenever the window is open (see
 * notification-templates.ts's order_digest — unchanged). */
export function buildWhatsAppTemplateParams(event: WhatsAppTemplateEvent, payload: Record<string, unknown>): string[] {
  switch (event) {
    case "order_broadcast_full":
      return [
        String(payload.orderNumber),
        String(payload.categoryName),
        String(payload.city),
        String(payload.whenText),
        String(payload.fullDescription),
        String(payload.clientPhone),
        String(payload.orderUrl),
      ];
    case "completion_checkin":
      return [String(payload.orderNumber), String(payload.categoryName), String(payload.orderUrl)];
    case "order_digest": {
      const orders = payload.orders as Array<{
        orderNumber: number;
        categoryName: string;
        city: string;
        whenText: string;
        orderUrl: string;
      }>;
      const latest = orders[orders.length - 1];
      return [String(orders.length), latest.categoryName, latest.city, latest.whenText, latest.orderUrl];
    }
    // 6 params, not 3 — category/summary text genuinely differs between ru
    // and kk (see ТЗ_прогрев_поставщиков_v2 5.1), city is duplicated into
    // both slots too even though it's the same value in practice, so the
    // template body never depends on a param happening to be
    // language-neutral.
    case "prospect_outreach":
      return [
        String(payload.categoryRu),
        String(payload.city),
        String(payload.summaryRu),
        String(payload.categoryKk),
        String(payload.city),
        String(payload.summaryKk),
      ];
  }
}
