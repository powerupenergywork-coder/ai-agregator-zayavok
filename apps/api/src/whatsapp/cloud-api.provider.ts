import { Injectable, Logger } from "@nestjs/common";
import { Language } from "@ai-zayavki/shared";
import { env } from "../config/env";
import { normalizePhone } from "../common/phone.util";
import { PrismaService } from "../prisma/prisma.service";
import { SentMessageId, WhatsAppButton, WhatsAppProvider } from "./whatsapp-provider.interface";

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
/** Cloud API отвечает {"messages":[{"id":"wamid...."}]} — по этому id потом
 * приходит статус доставки отдельным вебхуком. */
function messageIdOf(res: any): SentMessageId {
  return res?.messages?.[0]?.id;
}

@Injectable()
export class CloudApiProvider implements WhatsAppProvider {
  private readonly logger = new Logger(CloudApiProvider.name);
  private readonly baseUrl: string;

  constructor(private readonly prisma: PrismaService) {
    this.baseUrl = `https://graph.facebook.com/${env.whatsappCloudApiVersion}/${env.whatsappCloudPhoneNumberId}`;
  }

  async sendText(phone: string, text: string, opts?: { sensitive?: boolean }): Promise<SentMessageId> {
    const res = await this.call("messages", {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: this.toDigits(phone),
      type: "text",
      text: { body: text },
    });
    // Одноразовый код в стенограмме — лишний риск без всякой пользы для
    // разбора диалога, поэтому текст заменяем пометкой.
    await this.record(phone, "text", opts?.sensitive ? "[одноразовый код]" : text);
    return messageIdOf(res);
  }

  async sendButtons(phone: string, body: string, buttons: WhatsAppButton[], header?: string): Promise<SentMessageId> {
    const res = await this.call("messages", {
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
    await this.record(phone, "buttons", body, buttons.map((b) => b.id).join(" | "));
    return messageIdOf(res);
  }

  /** `templateName` must exactly match an approved template in Meta Business
   * Manager (see apps/api/src/notifications/whatsapp-templates.ts for the
   * required names) — an unrecognized or unapproved name fails the same way
   * a free-form send outside the 24h window does (this.call() throws,
   * caller logs it as a failed NotificationLog). */
  async sendTemplate(
    phone: string,
    templateName: string,
    lang: Language,
    bodyParams: string[],
    buttonPayloads?: string[],
  ): Promise<SentMessageId> {
    const components: Record<string, unknown>[] = [];
    if (bodyParams.length > 0) {
      components.push({
        type: "body",
        parameters: bodyParams.map((text) => ({ type: "text", text: this.flattenParam(text) })),
      });
    }
    (buttonPayloads ?? []).forEach((payload, index) => {
      components.push({
        type: "button",
        sub_type: "quick_reply",
        index: String(index),
        parameters: [{ type: "payload", payload }],
      });
    });

    const res = await this.call("messages", {
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
    await this.record(phone, "template", await this.renderForTranscript(templateName, bodyParams), templateName);
    return messageIdOf(res);
  }

  /**
   * Текст шаблона в том виде, в котором его увидел человек.
   *
   * Раньше в стенограмму шёл `bodyParams.join(" | ")` — то есть «Манипулятор |
   * Астана | 1 т, 10 августа | 50» вместо сообщения. Первое касание с
   * поставщиком всегда идёт шаблоном, поэтому самая важная реплика всей
   * воронки была единственной нечитаемой: понять, что именно человеку
   * написали и почему он ответил именно так, было нельзя.
   *
   * Тексты берём у Меты, а не держим копию в коде: копия разошлась бы с тем,
   * что реально утверждено, и стенограмма врала бы тем убедительнее, чем
   * дольше живёт. Тело шаблона после одобрения не меняется, поэтому кэша на
   * полсуток достаточно.
   */
  private async renderForTranscript(templateName: string, params: string[]): Promise<string> {
    const tpl = await this.templateBody(templateName);
    if (!tpl) return params.join(" | ");
    const body = tpl.body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? "");
    return tpl.buttons.length > 0 ? `${body}\n\n[ ${tpl.buttons.join(" ] [ ")} ]` : body;
  }

  private templates: Map<string, { body: string; buttons: string[] }> | null = null;
  private templatesLoadedAt = 0;

  private async templateBody(name: string) {
    const TWELVE_HOURS = 12 * 60 * 60 * 1000;
    if (!this.templates || Date.now() - this.templatesLoadedAt > TWELVE_HOURS) {
      await this.loadTemplates();
    }
    return this.templates?.get(name) ?? null;
  }

  /** Одним запросом на все шаблоны. Ошибка не критична: без текстов
   * стенограмма просто вернётся к списку подстановок, как было. */
  private async loadTemplates(): Promise<void> {
    this.templatesLoadedAt = Date.now();
    if (!env.whatsappCloudWabaId) return;
    try {
      const url =
        `https://graph.facebook.com/${env.whatsappCloudApiVersion}/${env.whatsappCloudWabaId}` +
        `/message_templates?limit=100&fields=name,components`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${env.whatsappCloudAccessToken}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      const json: any = await res.json();
      const map = new Map<string, { body: string; buttons: string[] }>();
      for (const t of json?.data ?? []) {
        const body = (t.components ?? []).find((c: any) => c.type === "BODY")?.text;
        const buttons = ((t.components ?? []).find((c: any) => c.type === "BUTTONS")?.buttons ?? []).map(
          (b: any) => b.text,
        );
        if (body) map.set(t.name, { body, buttons });
      }
      this.templates = map;
      this.logger.log(`Загружено текстов шаблонов для стенограммы: ${map.size}`);
    } catch (err) {
      this.logger.warn(`Не удалось загрузить тексты шаблонов: ${(err as Error).message}`);
    }
  }

  /**
   * Стенограмма пишется здесь, а не в сервисах: роутер и онбординг шлют
   * сообщения напрямую, минуя NotificationsService, и на уровне сервисов
   * половина переписки была бы потеряна.
   *
   * Сбой записи не должен ронять саму отправку — сообщение уже ушло, и
   * потерять его из-за проблем с логированием было бы хуже, чем потерять
   * строку стенограммы.
   */
  private async record(phone: string, kind: string, text?: string, payload?: string, unrecognized = false) {
    try {
      await this.prisma.whatsAppMessage.create({
        data: { phone: normalizePhone(phone), direction: "OUT", kind, text, payload, unrecognized },
      });
    } catch (err) {
      this.logger.warn(`Не удалось записать исходящее в стенограмму: ${(err as Error).message}`);
    }
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

  /**
   * Meta отклоняет параметр шаблона с переводом строки, табуляцией или
   * четырьмя пробелами подряд — ошибка 132018. А описание заявки многострочное
   * по своей природе (fullDescription, safeSummary), поэтому под запрет
   * попадала вся рассылка поставщикам, а не отдельный шаблон. Схлопываем здесь,
   * а не в каждом buildWhatsAppTemplateParams: так на это не наступит ни один
   * будущий шаблон. Перенос строки внутри параметра всё равно не виден —
   * в готовом сообщении вёрстку задаёт сам утверждённый шаблон.
   *
   * Пустая строка тоже отбивается, поэтому подставляем прочерк.
   */
  private flattenParam(text: string): string {
    // Разделитель именно видимый: схлопнутый в пробел многострочный список
    // превращается в сплошную кашу вида «Адрес: ул. Ерубаева, 12 Вид работ:
    // не знаю Вес груза: 2 т», где не видно, где кончается одно поле и
    // начинается следующее.
    const flat = text
      .replace(/[\r\n\t]+/g, " · ")
      .replace(/ {2,}/g, " ")
      .replace(/(?: · )+$/, "")
      .trim();
    return flat.length > 0 ? flat : "—";
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
