import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

// Event types per ТЗ п.30 — each call stores date/user/order/channel/device automatically.
export type AnalyticsEventType =
  | "landing_view"
  | "order_draft_started"
  | "first_message_sent"
  | "step_completed"
  | "fill_abandoned"
  | "otp_requested"
  | "otp_verified"
  | "order_published"
  | "order_sent_to_suppliers"
  /** Исполнитель открыл ссылку на заявку. Единственный признак интереса,
   *  который у нас есть до звонка, — см. OrdersService.countOrderViewers. */
  | "supplier_opened_order"
  | "order_cancelled"
  | "order_completed"
  | "order_redispatch_requested"
  | "repeat_order_created";

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async track(
    eventType: AnalyticsEventType,
    opts: { userId?: string; orderId?: string; channel?: string; device?: string; metadata?: Record<string, unknown> } = {},
  ) {
    await this.prisma.analyticsEvent.create({
      data: {
        eventType,
        userId: opts.userId,
        orderId: opts.orderId,
        channel: opts.channel,
        device: opts.device,
        metadata: opts.metadata as any,
      },
    });
  }
}
