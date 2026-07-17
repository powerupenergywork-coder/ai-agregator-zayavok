import { Injectable, Logger } from "@nestjs/common";
import { env } from "../config/env";
import { WhatsAppButton, WhatsAppProvider } from "./whatsapp-provider.interface";
import { phoneToChatId } from "./whatsapp.util";

/**
 * Real adapter for GREEN-API (green-api.com) — confirmed against their docs:
 * - Base URL: {GREEN_API_BASE_URL}/waInstance{idInstance}/{method}/{apiTokenInstance}
 * - sendMessage body: { chatId, message }
 * - sendInteractiveButtons body: { chatId, body, buttons: [{type:"reply", buttonId, buttonText}] },
 *   max 3 buttons, buttonText max 25 chars — caller (whatsapp-message-render.util.ts) enforces the
 *   3-button limit by falling back to a numbered text list beyond that.
 * - Incoming webhook auth: Authorization header, format set via SetSettings' webhookUrlToken
 *   (see WhatsAppController — verified there, not here).
 */
@Injectable()
export class GreenApiProvider implements WhatsAppProvider {
  private readonly logger = new Logger(GreenApiProvider.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = `${env.greenApiBaseUrl}/waInstance${env.greenApiIdInstance}`;
  }

  async sendText(phone: string, text: string): Promise<void> {
    await this.call("sendMessage", { chatId: phoneToChatId(phone), message: text });
  }

  async sendButtons(phone: string, body: string, buttons: WhatsAppButton[], header?: string): Promise<void> {
    await this.call("sendInteractiveButtons", {
      chatId: phoneToChatId(phone),
      header,
      body,
      buttons: buttons.slice(0, 3).map((b) => ({
        type: "reply",
        buttonId: b.id,
        buttonText: b.text.slice(0, 25),
      })),
    });
  }

  async downloadMedia(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download WhatsApp media: ${res.status} ${res.statusText}`);
    return Buffer.from(await res.arrayBuffer());
  }

  private async call(method: string, body: Record<string, unknown>): Promise<void> {
    const url = `${this.baseUrl}/${method}/${env.greenApiTokenInstance}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      this.logger.error(`GREEN-API ${method} failed: ${res.status} ${errorBody}`);
      throw new Error(`GREEN-API ${method} failed: ${res.status}`);
    }
  }
}
