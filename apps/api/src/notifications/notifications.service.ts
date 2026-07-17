import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SMS_PROVIDER, SmsProvider } from "../sms/sms-provider.interface";
import { WHATSAPP_PROVIDER, WhatsAppButton, WhatsAppProvider } from "../whatsapp/whatsapp-provider.interface";
import { NotificationEvent, renderTemplate } from "./notification-templates";

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
    const text = renderTemplate(opts.event, opts.payload);
    const channel = opts.channel ?? (await this.resolveChannel(opts.recipientPhone));

    let status: "SENT" | "FAILED" = "SENT";
    let errorMessage: string | undefined;

    try {
      if (channel === "SMS" && opts.recipientPhone) {
        await this.sms.send(opts.recipientPhone, text);
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

  private async resolveChannel(phone?: string): Promise<Channel> {
    if (!phone) return "CONSOLE";
    const user = await this.prisma.user.findUnique({ where: { phone } });
    return (user?.preferredChannel as Channel) ?? "SMS";
  }
}
