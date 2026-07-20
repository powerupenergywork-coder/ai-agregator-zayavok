import { Inject, Injectable, Logger } from "@nestjs/common";
import { Language } from "@ai-zayavki/shared";
import { PrismaService } from "../prisma/prisma.service";
import { toLang } from "../common/language.util";
import { SMS_PROVIDER, SmsProvider } from "../sms/sms-provider.interface";
import { WHATSAPP_PROVIDER, WhatsAppButton, WhatsAppProvider } from "../whatsapp/whatsapp-provider.interface";
import { NotificationEvent, renderTemplate } from "./notification-templates";
import { buildWhatsAppTemplateParams, isWhatsAppTemplateEvent, whatsappTemplateName, WhatsAppTemplateEvent } from "./whatsapp-templates";

// Meta's actual cutoff is 24h — this margin guards against clock skew and
// the time this request itself takes to run, so we don't attempt free text
// right at the edge and get error 131047 anyway.
const WHATSAPP_WINDOW_SAFETY_MARGIN_HOURS = 23;

type Channel = "SMS" | "WHATSAPP" | "TELEGRAM" | "EMAIL" | "CONSOLE";

interface SendOptions {
  event: NotificationEvent;
  payload: Record<string, unknown>;
  recipientPhone?: string;
  supplierId?: string;
  orderId?: string;
  /** Omit to auto-pick from the recipient's User.preferredChannel (defaults to SMS). */
  channel?: Channel;
  /** WhatsApp only (silently ignored elsewhere) — the template text should still include a plain link as a fallback. */
  buttons?: WhatsAppButton[];
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
  ) {}

  async send(opts: SendOptions): Promise<void> {
    const { channel: resolvedChannel, lang, lastInboundWhatsAppAt } = await this.resolveRecipient(opts.recipientPhone);
    const channel = opts.channel ?? resolvedChannel;
    const text = renderTemplate(opts.event, opts.payload, lang);

    let status: "SENT" | "FAILED" = "SENT";
    let errorMessage: string | undefined;

    try {
      if (channel === "SMS" && opts.recipientPhone) {
        await this.sms.send(opts.recipientPhone, text);
      } else if (channel === "WHATSAPP" && opts.recipientPhone && this.needsTemplate(opts.event, lastInboundWhatsAppAt)) {
        // 24h window is closed (or we've never heard from this phone) and
        // this event is business-initiated — free text would just get
        // rejected by Meta (error 131047), so use the pre-approved template
        // instead. See whatsapp-templates.ts for the exact registry.
        await this.whatsapp.sendTemplate(
          opts.recipientPhone,
          whatsappTemplateName(opts.event, lang),
          lang,
          buildWhatsAppTemplateParams(opts.event, opts.payload),
          opts.buttons?.map((b) => b.id),
        );
      } else if (channel === "WHATSAPP" && opts.recipientPhone && opts.buttons?.length) {
        await this.whatsapp.sendButtons(opts.recipientPhone, text, opts.buttons);
      } else if (channel === "WHATSAPP" && opts.recipientPhone) {
        await this.whatsapp.sendText(opts.recipientPhone, text);
      } else {
        this.logger.log(`[${channel}] ${opts.event} → ${opts.recipientPhone ?? "n/a"}: ${text}`);
      }
    } catch (err) {
      status = "FAILED";
      errorMessage = (err as Error).message;
      this.logger.error(`Notification ${opts.event} failed: ${errorMessage}`);
    }

    await this.prisma.notificationLog.create({
      data: {
        channel: channel as any,
        templateKey: opts.event,
        recipientPhone: opts.recipientPhone,
        supplierId: opts.supplierId,
        orderId: opts.orderId,
        payload: opts.payload as any,
        renderedText: text,
        status,
        errorMessage,
      },
    });
  }

  private needsTemplate(event: NotificationEvent, lastInboundWhatsAppAt: Date | null): event is WhatsAppTemplateEvent {
    if (!isWhatsAppTemplateEvent(event)) return false;
    if (!lastInboundWhatsAppAt) return true;
    const hoursSinceLastInbound = (Date.now() - lastInboundWhatsAppAt.getTime()) / (1000 * 60 * 60);
    return hoursSinceLastInbound >= WHATSAPP_WINDOW_SAFETY_MARGIN_HOURS;
  }

  private async resolveRecipient(phone?: string): Promise<{ channel: Channel; lang: Language; lastInboundWhatsAppAt: Date | null }> {
    if (!phone) return { channel: "CONSOLE", lang: "ru", lastInboundWhatsAppAt: null };
    const user = await this.prisma.user.findUnique({ where: { phone } });
    return {
      channel: (user?.preferredChannel as Channel) ?? "SMS",
      lang: user ? toLang(user.preferredLanguage) : "ru",
      lastInboundWhatsAppAt: user?.lastInboundWhatsAppAt ?? null,
    };
  }
}
