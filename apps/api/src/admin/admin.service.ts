import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { CategoryField, LocalizedText, ORDER_STATUS_LABELS_RU, OrderStatus } from "@ai-zayavki/shared";
import { PrismaService } from "../prisma/prisma.service";
import { OrdersService } from "../orders/orders.service";
import { deriveDenormalizedColumns } from "../orders/order-derive.util";
import { AuditLogService } from "../common/audit-log.service";
import { normalizePhone } from "../common/phone.util";
import { env } from "../config/env";
import { BillingService } from "../billing/billing.service";
import { ProspectService } from "../prospect/prospect.service";
import { AdminAuthUser } from "./admin-auth.guard";
import { UpsertSupplierDto } from "./dto/upsert-supplier.dto";
import { UpdateDispatchSettingsDto } from "./dto/update-dispatch-settings.dto";
import { AdminEditOrderDto } from "./dto/admin-edit-order.dto";
import { InitiateProspectDto } from "./dto/initiate-prospect.dto";

const QUEUE_STATUS_MAP: Record<string, OrderStatus[]> = {
  needs_review: ["NEEDS_OPERATOR"],
  cancelled: ["CANCELLED_BY_CLIENT", "CANCELLED_BY_ADMIN"],
  active: ["PUBLISHED"],
};

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly audit: AuditLogService,
    private readonly billing: BillingService,
    private readonly prospect: ProspectService,
    @InjectQueue("matching") private readonly matchingQueue: Queue,
  ) {}

  // ---------- suppliers ----------

  async listSuppliers(filters: { categorySlug?: string; city?: string; blocked?: boolean }) {
    const suppliers = await this.prisma.supplierProfile.findMany({
      where: {
        isBlocked: filters.blocked,
        ...(filters.categorySlug
          ? { categories: { some: { category: { slug: filters.categorySlug } } } }
          : {}),
        ...(filters.city ? { serviceAreas: { some: { city: filters.city } } } : {}),
      },
      include: { user: true, categories: { include: { category: true } }, serviceAreas: true, subscription: true },
      orderBy: { createdAt: "desc" },
    });
    return suppliers.map((s) => ({
      id: s.id,
      phone: s.user.phone,
      companyName: s.companyName,
      rating: s.rating,
      completedOrders: s.completedOrders,
      cancelledOrders: s.cancelledOrders,
      declinedAfterSelected: s.declinedAfterSelected,
      activityStatus: s.activityStatus,
      isBlocked: s.isBlocked,
      needsReview: s.needsReview,
      acceptsUrgent: s.acceptsUrgent,
      categories: s.categories.map((c) => c.category.slug),
      cities: s.serviceAreas.map((a) => a.city),
      notificationsUsedThisMonth: s.notificationsUsedThisMonth,
      subscriptionActive: this.billing.isSubscriptionActive(s.subscription),
      subscriptionExpiresAt: s.subscription?.currentPeriodEnd ?? null,
      createdAt: s.createdAt,
    }));
  }

  async setSupplierSubscription(id: string, active: boolean, admin: AdminAuthUser) {
    const supplier = await this.prisma.supplierProfile.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException("Поставщик не найден");
    await this.billing.adminSetSubscription(id, active);
    await this.audit.log({
      actorType: admin.role === "ADMIN" ? "admin" : "operator",
      actorId: admin.sub,
      action: active ? "admin_activate_subscription" : "admin_deactivate_subscription",
      targetType: "SupplierProfile",
      targetId: id,
    });
  }

  async upsertSupplier(dto: UpsertSupplierDto, admin: AdminAuthUser) {
    const phone = normalizePhone(dto.phone);
    const user = await this.prisma.user.upsert({ where: { phone }, create: { phone }, update: {} });
    let supplier = await this.prisma.supplierProfile.findUnique({ where: { userId: user.id } });
    if (!supplier) {
      supplier = await this.prisma.supplierProfile.create({ data: { userId: user.id } });
    }

    await this.prisma.supplierProfile.update({
      where: { id: supplier.id },
      data: {
        companyName: dto.companyName,
        isBlocked: dto.isBlocked ?? supplier.isBlocked,
        acceptsUrgent: dto.acceptsUrgent ?? supplier.acceptsUrgent,
      },
    });

    const categories = await this.prisma.category.findMany({ where: { slug: { in: dto.categorySlugs } } });
    await this.prisma.supplierCategory.deleteMany({ where: { supplierId: supplier.id } });
    await this.prisma.supplierCategory.createMany({
      data: categories.map((c) => ({ supplierId: supplier!.id, categoryId: c.id })),
    });

    await this.prisma.serviceArea.deleteMany({ where: { supplierId: supplier.id } });
    await this.prisma.serviceArea.createMany({
      data: dto.cities.map((city) => ({ supplierId: supplier!.id, city })),
    });

    await this.audit.log({
      actorType: admin.role === "ADMIN" ? "admin" : "operator",
      actorId: admin.sub,
      action: "upsert_supplier",
      targetType: "SupplierProfile",
      targetId: supplier.id,
    });

    return { id: supplier.id };
  }

  async setSupplierBlocked(id: string, blocked: boolean, admin: AdminAuthUser) {
    const supplier = await this.prisma.supplierProfile.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException("Поставщик не найден");
    await this.prisma.supplierProfile.update({
      where: { id },
      data: { isBlocked: blocked, activityStatus: blocked ? "BLOCKED" : "ACTIVE" },
    });
    await this.audit.log({
      actorType: admin.role === "ADMIN" ? "admin" : "operator",
      actorId: admin.sub,
      action: blocked ? "block_supplier" : "unblock_supplier",
      targetType: "SupplierProfile",
      targetId: id,
    });
  }

  async markSupplierReviewed(id: string, admin: AdminAuthUser) {
    const supplier = await this.prisma.supplierProfile.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException("Поставщик не найден");
    await this.prisma.supplierProfile.update({ where: { id }, data: { needsReview: false } });
    await this.audit.log({
      actorType: admin.role === "ADMIN" ? "admin" : "operator",
      actorId: admin.sub,
      action: "mark_supplier_reviewed",
      targetType: "SupplierProfile",
      targetId: id,
    });
  }

  // ---------- orders ----------

  async listOrders(filters: { status?: string; queue?: string }) {
    const statuses = filters.queue ? QUEUE_STATUS_MAP[filters.queue] : filters.status ? [filters.status] : undefined;
    const orders = await this.prisma.order.findMany({
      where: statuses ? { status: { in: statuses } } : undefined,
      include: { category: true, dispatchWaves: true, client: { include: { user: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return orders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      statusLabel: ORDER_STATUS_LABELS_RU[o.status as OrderStatus],
      // Admin panel is Russian-only by design (see project notes) — Category.name
      // became a {ru,kk} JSON object for the bilingual client/WhatsApp UI, but
      // this response feeds a plain-string-expecting admin table, so resolve
      // it here rather than leaking the raw object (React can't render it).
      categoryName: o.category ? (o.category.name as unknown as LocalizedText).ru : null,
      city: o.city,
      urgent: o.urgent,
      notifiedSuppliersCount: new Set(o.dispatchWaves.flatMap((w) => w.supplierIds as string[])).size,
      clientPhone: o.client?.user.phone ?? null,
      createdAt: o.createdAt,
      publishedAt: o.publishedAt,
    }));
  }

  async editOrder(orderId: string, dto: AdminEditOrderDto, admin: AdminAuthUser) {
    const order = await this.orders.getRawOrThrow(orderId);
    const data: Record<string, unknown> = {};

    let category = order.categoryId
      ? await this.prisma.category.findUnique({ where: { id: order.categoryId } })
      : null;
    if (dto.categorySlug) {
      category = await this.prisma.category.findUnique({ where: { slug: dto.categorySlug } });
      if (!category) throw new BadRequestException("Категория не найдена");
      data.categoryId = category.id;
    }

    if (dto.fieldsData) {
      const mergedFields = { ...((order.fieldsData ?? {}) as Record<string, unknown>), ...dto.fieldsData };
      data.fieldsData = mergedFields;
      // Keep addressFrom/city/dateNeeded/timeWindow in sync — matching reads
      // those plain columns, not fieldsData, so an admin correction here
      // would otherwise silently keep dispatching against the old city.
      if (category) {
        Object.assign(data, deriveDenormalizedColumns(category.fields as unknown as CategoryField[], mergedFields));
      }
    }
    if (Object.keys(data).length > 0) {
      await this.prisma.order.update({ where: { id: orderId }, data });
    }

    await this.audit.log({
      actorType: admin.role === "ADMIN" ? "admin" : "operator",
      actorId: admin.sub,
      action: "edit_order",
      targetType: "Order",
      targetId: orderId,
      metadata: { ...dto },
    });

    return this.orders.toDto(orderId);
  }

  async redispatch(orderId: string, admin: AdminAuthUser) {
    const order = await this.orders.getRawOrThrow(orderId);
    if (order.status === "NEEDS_OPERATOR") {
      await this.orders.transitionStatus(orderId, "PUBLISHED", `operator:${admin.sub}`, "Повторная рассылка");
      // The original publish()'s check-in/escalate timers already fired a
      // no-op against this order's since-changed (NEEDS_OPERATOR) status —
      // reactivating it needs its own fresh window, or it can sit in
      // PUBLISHED forever with nothing prompting the client to close it.
      await this.orders.scheduleCompletionCheckins(orderId);
    } else if (order.status !== "PUBLISHED") {
      throw new BadRequestException("Повторная рассылка недоступна в текущем статусе заявки");
    }
    await this.matchingQueue.add("start", { orderId });
    await this.audit.log({
      actorType: admin.role === "ADMIN" ? "admin" : "operator",
      actorId: admin.sub,
      action: "redispatch_order",
      targetType: "Order",
      targetId: orderId,
    });
    return { ok: true };
  }

  async adminCancel(orderId: string, admin: AdminAuthUser, reason: string) {
    const order = await this.orders.getRawOrThrow(orderId);
    await this.orders.transitionStatus(orderId, "CANCELLED_BY_ADMIN", `operator:${admin.sub}`, reason);
    await this.prisma.order.update({
      where: { id: orderId },
      data: { cancelledAt: new Date(), cancelReason: reason },
    });

    await this.orders.notifyDispatchedSuppliers(orderId, order.number, "order_cancelled");

    await this.audit.log({
      actorType: admin.role === "ADMIN" ? "admin" : "operator",
      actorId: admin.sub,
      action: "admin_cancel_order",
      targetType: "Order",
      targetId: orderId,
      metadata: { reason },
    });

    return this.orders.toDto(orderId);
  }

  // ---------- dispatch settings ----------

  async getDispatchSettings() {
    const existing = await this.prisma.dispatchSettings.findFirst();
    if (existing) return existing;
    return this.prisma.dispatchSettings.create({
      data: { waveSize: env.dispatchWaveSize },
    });
  }

  async updateDispatchSettings(dto: UpdateDispatchSettingsDto, admin: AdminAuthUser) {
    const current = await this.getDispatchSettings();
    const updated = await this.prisma.dispatchSettings.update({
      where: { id: current.id },
      data: dto,
    });
    await this.audit.log({
      actorType: admin.role === "ADMIN" ? "admin" : "operator",
      actorId: admin.sub,
      action: "update_dispatch_settings",
      metadata: { ...dto },
    });
    return updated;
  }

  // ---------- prospects (прогрев поставщиков) ----------

  async listProspects(filters: { status?: string; city?: string; categorySlug?: string }) {
    return this.prospect.listProspects(filters);
  }

  async getProspectFunnel() {
    return this.prospect.getFunnel();
  }

  async initiateProspect(dto: InitiateProspectDto, admin: AdminAuthUser) {
    return this.prospect.initiateColdOutreach(dto.phone, dto.orderId, {
      type: admin.role === "ADMIN" ? "admin" : "operator",
      id: admin.sub,
    });
  }
}
