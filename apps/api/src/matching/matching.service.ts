import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { OrdersService } from "../orders/orders.service";
import { NotificationsService } from "../notifications/notifications.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { BillingService } from "../billing/billing.service";
import { env } from "../config/env";
import { formatWhen, fullDescription } from "./matching-message.util";
import { isSupplierReachableNow } from "./quiet-hours.util";
import { toLang } from "../common/language.util";
import { CategoryField, LocalizedText } from "@ai-zayavki/shared";

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

    for (const supplier of candidates) {
      await this.dispatchToSupplier(order, supplier, settings);
    }

    await this.analytics.track("order_sent_to_suppliers", {
      orderId,
      metadata: { waveNumber, count: candidates.length },
    });
    this.realtime.emitOrderUpdated(orderId, await this.orders.toDto(orderId));
  }

  /** One supplier, one order — quiet-hours deferral, quota gate, then the
   * full order_broadcast_full send. Shared by sendWave()'s loop above and
   * notifyConvertedProspect() below, so a freshly-registered PROSPECT gets
   * exactly the same treatment (quota consumed, quiet hours respected) as
   * anyone reached through the normal wave. */
  private async dispatchToSupplier(
    order: Awaited<ReturnType<MatchingService["loadOrderForDispatch"]>>,
    supplier: { id: string; user: { phone: string; preferredLanguage: string }; workingHoursStart: string | null; workingHoursEnd: string | null },
    settings: { quietHoursStart: string | null; quietHoursEnd: string | null },
  ): Promise<void> {
    // Non-urgent orders respect the supplier's quiet hours — held here
    // instead of sent immediately, then batched into one digest message
    // per supplier by flushPendingDigests() once their window opens.
    // Urgent orders always go through immediately: acceptsUrgent (already
    // enforced by the caller) is the supplier's own agreement to be
    // reachable any time for those.
    if (!order.urgent && !isSupplierReachableNow(supplier, settings)) {
      await this.prisma.pendingSupplierNotification.upsert({
        where: { supplierId_orderId: { supplierId: supplier.id, orderId: order.id } },
        create: { supplierId: supplier.id, orderId: order.id },
        update: {},
      });
      return;
    }

    // Quota-blocked suppliers still count as "notified" for this order —
    // the caller already recorded them in DispatchWave.supplierIds and
    // won't reconsider them on a later wave; they just don't get the job
    // notification itself, only (at most once/day) a subscribe reminder.
    const canNotify = await this.billing.checkAndConsumeQuota(supplier.id);
    if (!canNotify) {
      await this.billing.maybeSendQuotaReminder(supplier.id, supplier.user.phone);
      return;
    }

    const lang = toLang(supplier.user.preferredLanguage);
    await this.notifications.send({
      event: "order_broadcast_full",
      payload: {
        orderNumber: order.number,
        categoryName: order.category ? (order.category.name as unknown as LocalizedText)[lang] : "",
        city: order.city ?? "",
        whenText: formatWhen(order, lang),
        fullDescription: fullDescription(order.fieldsData, (order.category?.fields as unknown as CategoryField[]) ?? [], lang),
        clientPhone: order.client?.user.phone ?? (lang === "kk" ? "көрсетілмеген" : "не указан"),
        orderUrl: `${env.webUrl}/s/${order.id}`,
      },
      recipientPhone: supplier.user.phone,
      supplierId: supplier.id,
      orderId: order.id,
    });
  }

  private async loadOrderForDispatch(orderId: string) {
    return this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { category: true, client: { include: { user: true } } },
    });
  }

  /** Called once a PROSPECT-onboarded supplier clears needsReview (see
   * ProspectService.markConverted) — ТЗ_прогрев_поставщиков_v2 п.3.6: "по
   * возможности" notify them about the anchor order that hooked them in the
   * first place. DispatchWave.supplierIds for that order predates this
   * supplier's profile, so sendWave()'s normal excludeIds logic would never
   * pick them up on its own — this is the dedicated, one-off path instead.
   * Falls back to the next matching PUBLISHED order (same category/city) if
   * the anchor order is no longer PUBLISHED. No-ops if nothing matches. */
  async notifyConvertedProspect(supplierId: string, anchorOrderId: string): Promise<void> {
    const supplier = await this.prisma.supplierProfile.findUnique({
      where: { id: supplierId },
      include: { user: true },
    });
    if (!supplier) return;

    const anchor = await this.prisma.order.findUnique({ where: { id: anchorOrderId } });
    const targetOrderId = anchor?.status === "PUBLISHED" ? anchorOrderId : await this.findNextMatchingOrderId(supplierId);
    if (!targetOrderId) return;

    const order = await this.loadOrderForDispatch(targetOrderId);
    const settings = await this.getSettings();
    await this.prisma.dispatchWave.create({
      data: {
        orderId: targetOrderId,
        waveNumber: (await this.prisma.dispatchWave.count({ where: { orderId: targetOrderId } })) + 1,
        supplierIds: [supplier.id],
      },
    });
    await this.dispatchToSupplier(order, supplier, settings);
    this.realtime.emitOrderUpdated(targetOrderId, await this.orders.toDto(targetOrderId));
  }

  private async findNextMatchingOrderId(supplierId: string): Promise<string | null> {
    const supplier = await this.prisma.supplierProfile.findUniqueOrThrow({
      where: { id: supplierId },
      include: { categories: true, serviceAreas: true },
    });
    const categoryIds = supplier.categories.map((c) => c.categoryId);
    const cities = supplier.serviceAreas.map((a) => a.city);
    if (categoryIds.length === 0) return null;

    // DispatchWave.supplierIds is a JSON array — filtering it from SQL isn't
    // a pattern used elsewhere in this codebase (see
    // getAlreadyNotifiedSupplierIds below), so stay consistent: fetch
    // candidates, exclude already-notified in JS. Order volume is low
    // enough that this isn't a real cost.
    const candidates = await this.prisma.order.findMany({
      where: {
        status: "PUBLISHED",
        categoryId: { in: categoryIds },
        ...(cities.length > 0 ? { city: { in: cities, mode: "insensitive" } } : {}),
      },
      include: { dispatchWaves: true },
      orderBy: { createdAt: "desc" },
    });
    const match = candidates.find((o) => !o.dispatchWaves.some((w) => (w.supplierIds as string[]).includes(supplierId)));
    return match?.id ?? null;
  }

  /** Counterpart to the quiet-hours deferral in sendWave(): for every
   * supplier whose window has now opened, collect everything held for them
   * and send it as one order_digest message instead of one ping per order. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async flushPendingDigests() {
    const pending = await this.prisma.pendingSupplierNotification.findMany({
      include: {
        supplier: { include: { user: true } },
        order: { include: { category: true, client: { include: { user: true } } } },
      },
    });
    if (pending.length === 0) return;

    const settings = await this.getSettings();
    const bySupplier = new Map<string, typeof pending>();
    for (const row of pending) {
      if (!isSupplierReachableNow(row.supplier, settings)) continue;
      const list = bySupplier.get(row.supplierId) ?? [];
      list.push(row);
      bySupplier.set(row.supplierId, list);
    }

    for (const [supplierId, rows] of bySupplier) {
      const supplier = rows[0].supplier;
      const included: typeof rows = [];
      for (const row of rows) {
        const canNotify = await this.billing.checkAndConsumeQuota(supplierId);
        if (!canNotify) {
          await this.billing.maybeSendQuotaReminder(supplierId, supplier.user.phone);
          continue; // stays pending for the next flush (or next month's quota reset)
        }
        included.push(row);
      }
      if (included.length === 0) continue;

      const lang = toLang(supplier.user.preferredLanguage);
      await this.notifications.send({
        event: "order_digest",
        payload: {
          orders: included.map((row) => ({
            orderNumber: row.order.number,
            categoryName: row.order.category ? (row.order.category.name as unknown as LocalizedText)[lang] : "",
            city: row.order.city ?? "",
            whenText: formatWhen(row.order, lang),
            fullDescription: fullDescription(
              row.order.fieldsData,
              (row.order.category?.fields as unknown as CategoryField[]) ?? [],
              lang,
            ),
            clientPhone: row.order.client?.user.phone ?? (lang === "kk" ? "көрсетілмеген" : "не указан"),
            orderUrl: `${env.webUrl}/s/${row.orderId}`,
          })),
        },
        recipientPhone: supplier.user.phone,
        supplierId,
      });

      await this.prisma.pendingSupplierNotification.deleteMany({
        where: { id: { in: included.map((row) => row.id) } },
      });
    }
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
        // Case-insensitive: the city comes from free-text answers on both
        // sides (client's order field, supplier's onboarding list) — no
        // reason to let a stray capital letter split otherwise-identical names.
        ...(order.city ? { serviceAreas: { some: { city: { equals: order.city, mode: "insensitive" } } } } : {}),
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
