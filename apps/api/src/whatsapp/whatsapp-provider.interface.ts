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
}

export const WHATSAPP_PROVIDER = Symbol("WHATSAPP_PROVIDER");
