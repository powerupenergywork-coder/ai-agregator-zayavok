import { Injectable, Logger } from "@nestjs/common";
import { Language } from "@ai-zayavki/shared";
import { env } from "../config/env";
import { normalizePhone } from "../common/phone.util";
import { WhatsAppButton, WhatsAppProvider } from "./whatsapp-provider.interface";

/**
 * Official Meta WhatsApp Cloud API adapter — confirmed against Meta's docs:
 * - Send: POST https://graph.facebook.com/{version}/{phoneNumberId}/messages,
 *   Authorization: Bearer {accessToken}, body messaging_product:"whatsapp".
 * - Interactive reply buttons: type:"interactive", interactive.type:"button",
 *   max 3 buttons, button title max 20 chars (stricter than GREEN-API's 25).
 * - Unlike GREEN-API there is no synchronous "does this number have WhatsApp"
 *   check — delivery failures surface later via webhook status callbacks, so
 *   checkExists() can't give a real answer here; see method comment below.
 * - Media arrives in webhooks as an opaque media id, not a URL: downloadMedia()
 *   repurposes its `url` param to accept that id and resolves it via the
 *   two-step id -> temp URL -> bytes flow (see whatsapp.controller.ts caller).
 */
@Injectable()
export class CloudApiProvider implements WhatsAppProvider {
  private readonly logger = new Logger(CloudApiProvider.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = `https://graph.facebook.com/${env.whatsappCloudApiVersion}/${env.whatsappCloudPhoneNumberId}`;
  }

  async sendText(phone: string, text: string): Promise<void> {
    await this.call("messages", {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: this.toDigits(phone),
      type: "text",
      text: { body: text },
    });
  }

  async sendButtons(phone: string, body: string, buttons: WhatsAppButton[], header?: string): Promise<void> {
    await this.call("messages", {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: this.toDigits(phone),
      type: "interactive",
      interactive: {
        type: "button",
        ...(header ? { header: { type: "text", text: header } } : {}),
        body: { text: body },
        action: {
          buttons: buttons.slice(0, 3).map((b) => ({
            type: "reply",
            reply: { id: b.id, title: b.text.slice(0, 20) },
          })),
        },
      },
    });
  }

  /** `templateName` must exactly match an approved template in Meta Business
   * Manager (see apps/api/src/notifications/whatsapp-templates.ts for the
   * required names) — an unrecognized or unapproved name fails the same way
   * a free-form send outside the 24h window does (this.call() throws,
   * caller logs it as a failed NotificationLog). */
  async sendTemplate(phone: string, templateName: string, lang: Language, bodyParams: string[], buttonPayloads?: string[]): Promise<void> {
    const components: Record<string, unknown>[] = [];
    if (bodyParams.length > 0) {
      components.push({ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) });
    }
    (buttonPayloads ?? []).forEach((payload, index) => {
      components.push({
        type: "button",
        sub_type: "quick_reply",
        index: String(index),
        parameters: [{ type: "payload", payload }],
      });
    });

    await this.call("messages", {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: this.toDigits(phone),
      type: "template",
      template: {
        name: templateName,
        language: { code: lang },
        ...(components.length > 0 ? { components } : {}),
      },
    });
  }

  async downloadMedia(mediaId: string): Promise<Buffer> {
    const metaRes = await fetch(`https://graph.facebook.com/${env.whatsappCloudApiVersion}/${mediaId}`, {
      headers: { Authorization: `Bearer ${env.whatsappCloudAccessToken}` },
    });
    if (!metaRes.ok) {
      throw new Error(`Cloud API media lookup failed: ${metaRes.status} ${await metaRes.text().catch(() => "")}`);
    }
    const { url } = (await metaRes.json()) as { url?: string };
    if (!url) throw new Error("Cloud API media lookup returned no url");

    const mediaRes = await fetch(url, { headers: { Authorization: `Bearer ${env.whatsappCloudAccessToken}` } });
    if (!mediaRes.ok) throw new Error(`Cloud API media download failed: ${mediaRes.status}`);
    return Buffer.from(await mediaRes.arrayBuffer());
  }

  /** Cloud API has no synchronous "has WhatsApp" check like GREEN-API's
   * checkWhatsapp — a send to a nonexistent number is only reported later via
   * an async "failed" status webhook. Assuming true preserves the existing
   * try-WhatsApp-first behavior in AuthOtpService; it just can't short-circuit
   * to SMS proactively the way the GREEN-API path can. */
  async checkExists(_phone: string): Promise<boolean> {
    return true;
  }

  private toDigits(phone: string): string {
    const digits = normalizePhone(phone).replace(/[^\d]/g, "");
    // TEST-ONLY escape hatch: Meta's test-recipient allowlist can end up
    // storing a number with a stray digit baked in (seen with +7 numbers,
    // where the dashboard's country widget sometimes keeps the domestic
    // trunk "8" alongside the "+7" country code) — a Meta dashboard bug, not
    // a real production concern, since production WABA numbers have no
    // allowlist at all. WHATSAPP_CLOUD_SANDBOX_PHONE/_TO let us route around
    // one specific broken sandbox entry instead of bending toDigits() itself.
    if (env.whatsappCloudSandboxPhone && env.whatsappCloudSandboxTo && digits === env.whatsappCloudSandboxPhone) {
      return env.whatsappCloudSandboxTo;
    }
    return digits;
  }

  private async call(path: string, body: Record<string, unknown>): Promise<any> {
    const res = await fetch(`${this.baseUrl}/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.whatsappCloudAccessToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      this.logger.error(`Cloud API ${path} failed: ${res.status} ${errorBody}`);
      throw new Error(`Cloud API ${path} failed: ${res.status}`);
    }
    return res.json().catch(() => undefined);
  }
}
