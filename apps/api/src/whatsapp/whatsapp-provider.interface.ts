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
}

export const WHATSAPP_PROVIDER = Symbol("WHATSAPP_PROVIDER");
