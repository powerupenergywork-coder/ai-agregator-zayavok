import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { OrdersService } from "../orders/orders.service";
import { NotificationsService } from "../notifications/notifications.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { BillingService } from "../billing/billing.service";
import { env } from "../config/env";
import { formatWhen, fullDescription } from "./matching-message.util";
import { CategoryField } from "@ai-zayavki/shared";

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly notifications: NotificationsService,
    private readonly analytics: AnalyticsService,
    private readonly realtime: RealtimeGateway,
    private readonly billing: BillingService,
    @InjectQueue("matching") private readonly matchingQueue: Queue,
  ) {}

  async startDispatch(orderId: string) {
    await this.sendWave(orderId);
  }

  /** Broadcasts the order — with full description and the client's contact —
   * to up to waveSize new matching suppliers. Lead-broadcast model: no offer
   * collection, no exclusivity, suppliers call the client directly. Called
   * on publish and again (manually) via admin redispatch — either way it
   * only reaches suppliers not already notified for this order. */
  async sendWave(orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { category: true, client: { include: { user: true } } },
    });
    if (order.status !== "PUBLISHED") return;

    const settings = await this.getSettings();
    const excludeIds = await this.getAlreadyNotifiedSupplierIds(orderId);
    const candidates = await this.findCandidates(order, excludeIds, settings.waveSize);

    if (candidates.length === 0) {
      if (excludeIds.length === 0) {
        const reason = "Нет подходящих поставщиков для этой категории/города";
        await this.orders.transitionStatus(orderId, "NEEDS_OPERATOR", "system", reason);
        await this.notifications.send({ event: "needs_operator", payload: { orderNumber: order.number, reason }, orderId });
        this.realtime.emitOrderUpdated(orderId, await this.orders.toDto(orderId));
      }
      return;
    }

    const waveNumber = (await this.prisma.dispatchWave.count({ where: { orderId } })) + 1;
    await this.prisma.dispatchWave.create({
      data: { orderId, waveNumber, supplierIds: candidates.map((c) => c.id) },
    });

    const orderUrl = `${env.webUrl}/s/${orderId}`;
    for (const supplier of candidates) {
      // Quota-blocked suppliers still count as "notified" for this order —
      // they were already written into DispatchWave.supplierIds above and
      // won't be reconsidered by a later wave; they just don't get the job
      // notification itself, only (at most once/day) a subscribe reminder.
      const canNotify = await this.billing.checkAndConsumeQuota(supplier.id);
      if (!canNotify) {
        await this.billing.maybeSendQuotaReminder(supplier.id, supplier.user.phone);
        continue;
      }

      await this.notifications.send({
        event: "order_broadcast_full",
        payload: {
          orderNumber: order.number,
          categoryName: order.category?.name ?? "",
          city: order.city ?? "",
          whenText: formatWhen(order),
          fullDescription: fullDescription(order.fieldsData, (order.category?.fields as unknown as CategoryField[]) ?? []),
          clientPhone: order.client?.user.phone ?? "не указан",
          orderUrl,
        },
        recipientPhone: supplier.user.phone,
        supplierId: supplier.id,
        orderId,
      });
    }

    await this.analytics.track("order_sent_to_suppliers", {
      orderId,
      metadata: { waveNumber, count: candidates.length },
    });
    this.realtime.emitOrderUpdated(orderId, await this.orders.toDto(orderId));
  }

  private async findCandidates(
    order: { id: string; categoryId: string | null; city: string | null; urgent: boolean },
    excludeIds: string[],
    limit: number,
  ) {
    if (!order.categoryId) return [];

    return this.prisma.supplierProfile.findMany({
      where: {
        isBlocked: false,
        activityStatus: "ACTIVE",
        id: { notIn: excludeIds },
        categories: { some: { categoryId: order.categoryId } },
        ...(order.city ? { serviceAreas: { some: { city: order.city } } } : {}),
        // acceptsUrgent is collected at onboarding specifically so suppliers
        // can opt out of rush jobs — only worth enforcing for urgent orders;
        // non-urgent dispatch shouldn't care either way.
        ...(order.urgent ? { acceptsUrgent: true } : {}),
      },
      include: { user: true },
      orderBy: [{ rating: "desc" }],
      take: limit,
    });
  }

  private async getAlreadyNotifiedSupplierIds(orderId: string): Promise<string[]> {
    const waves = await this.prisma.dispatchWave.findMany({ where: { orderId } });
    const ids = new Set<string>();
    for (const wave of waves) {
      for (const id of wave.supplierIds as string[]) ids.add(id);
    }
    return Array.from(ids);
  }

  private async getSettings() {
    const existing = await this.prisma.dispatchSettings.findFirst();
    if (existing) return existing;
    return this.prisma.dispatchSettings.create({
      data: { waveSize: env.dispatchWaveSize },
    });
  }
}
