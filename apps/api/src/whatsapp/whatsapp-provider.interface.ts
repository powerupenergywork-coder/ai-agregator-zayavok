import { Language } from "@ai-zayavki/shared";

export interface WhatsAppButton {
  /** Echoed back verbatim in the tap webhook — encodes what to do next, e.g. "cat:gazelle". */
  id: string;
  /** WhatsApp hard-limits button text to 25 chars — providers should truncate, not throw. */
  text: string;
}

export interface WhatsAppProvider {
  sendText(phone: string, text: string): Promise<void>;
  /** At most 3 buttons — that's a WhatsApp platform limit, not ours. Callers must fall back to a numbered list beyond that. */
  sendButtons(phone: string, body: string, buttons: WhatsAppButton[], header?: string): Promise<void>;
  downloadMedia(url: string): Promise<Buffer>;
  /** sendText/sendButtons don't fail for a number with no WhatsApp account —
   * the platform just silently never delivers. Callers that need a real
   * signal (e.g. deciding whether to fall back to SMS) must check first. */
  checkExists(phone: string): Promise<boolean>;
  /** Pre-approved template message — required by Meta's Cloud API whenever
   * the recipient's 24h customer-service window may be closed (see
   * NotificationsService). `templateName` must exactly match what's
   * registered (and approved) in Meta Business Manager for that language —
   * see apps/api/src/notifications/whatsapp-templates.ts. `bodyParams` fill
   * the template's {{1}}, {{2}}... placeholders in order; `buttonPayloads`
   * (if the template has quick-reply buttons) fill each button's dynamic
   * payload in the order the buttons were declared — button *labels* are
   * fixed at template-approval time, not sent here.
   *
   * Providers without Meta's window restriction (console, GREEN-API) can
   * just render the same params as free text — there's no real "template"
   * concept there. */
  sendTemplate(phone: string, templateName: string, lang: Language, bodyParams: string[], buttonPayloads?: string[]): Promise<void>;
}

export const WHATSAPP_PROVIDER = Symbol("WHATSAPP_PROVIDER");
