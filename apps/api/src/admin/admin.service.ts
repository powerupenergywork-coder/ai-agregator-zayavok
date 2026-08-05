import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import {
  CategoryField,
  LocalizedText,
  ORDER_STATUS_LABELS_RU,
  OrderStatus,
  citySuggestions,
  resolveCityList,
} from "@ai-zayavki/shared";
import { PrismaService } from "../prisma/prisma.service";
import { OrdersService } from "../orders/orders.service";
import { deriveDenormalizedColumns } from "../orders/order-derive.util";
import { AuditLogService } from "../common/audit-log.service";
import { normalizePhone, isValidPhone } from "../common/phone.util";
import { env } from "../config/env";
import { BillingService } from "../billing/billing.service";
import { ProspectService } from "../prospect/prospect.service";
import { AdminAuthUser } from "./admin-auth.guard";
import { UpsertSupplierDto } from "./dto/upsert-supplier.dto";
import { ImportSuppliersDto } from "./dto/import-suppliers.dto";
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
      confirmedAt: s.confirmedAt,
      acceptsUrgent: s.acceptsUrgent,
      // Both, deliberately. The slug is what the add-supplier form takes, so
      // it has to stay visible — but "crane" and "crane-truck" are an
      // autocrane and a manipulator, two different machines that are easy to
      // pick wrong from the slug alone, and picking wrong sends a supplier
      // somebody else's orders with nothing to notice it by.
      categories: s.categories.map((c) => c.category.slug),
      categoryNames: s.categories.map((c) => ({
        slug: c.category.slug,
        name: (c.category.name as unknown as LocalizedText).ru,
      })),
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
    // Bulk-loading suppliers from public directories is the main way the
    // base gets filled, so a typo here would quietly cost that supplier
    // every order in their city. Reject rather than store something dispatch
    // can't match.
    const { cities: resolvedCities, unresolved } = resolveCityList(dto.cities.join(","));
    if (unresolved.length > 0) {
      throw new BadRequestException(`Не распознаны города: ${unresolved.join(", ")}. Доступные: ${citySuggestions("ru", 12)}`);
    }
    if (resolvedCities.length === 0) {
      throw new BadRequestException("Укажите хотя бы один город");
    }
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
      data: resolvedCities.map((c) => ({ supplierId: supplier!.id, city: c.name.ru })),
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

  /**
   * Bulk-loads a collected supplier sheet. The sheet has one row per
   * (phone, category) pair, so the same supplier appears several times and
   * duplicate pairs are normal rather than exceptional — rows are merged by
   * phone before anything is written, or a second row would wipe the
   * categories the first one just created.
   *
   * Runs as a dry run unless told otherwise: the point is to see the report
   * before a hundred rows land in production, and a bad city or a mistyped
   * slug costs that supplier every order in silence.
   */
  async importSuppliers(dto: ImportSuppliersDto, admin: AdminAuthUser) {
    const dryRun = dto.dryRun !== false;
    const known = new Set((await this.prisma.category.findMany({ select: { slug: true } })).map((c) => c.slug));

    interface Merged {
      phone: string;
      companyName?: string;
      cities: Set<string>;
      slugs: Set<string>;
      rows: number[];
    }
    const merged = new Map<string, Merged>();
    const rejected: { row: number; phone: string; reason: string }[] = [];
    let duplicatePairs = 0;

    dto.rows.forEach((r, i) => {
      const line = i + 2; // sheet row, counting the header
      const phone = normalizePhone(r.phone ?? "");
      if (!isValidPhone(phone)) {
        rejected.push({ row: line, phone: r.phone, reason: "номер не распознан" });
        return;
      }
      if (!known.has(r.categorySlug)) {
        rejected.push({ row: line, phone, reason: `нет такой категории: ${r.categorySlug}` });
        return;
      }
      const { cities, unresolved } = resolveCityList(r.city ?? "");
      if (unresolved.length > 0 || cities.length === 0) {
        rejected.push({ row: line, phone, reason: `город не распознан: ${r.city}` });
        return;
      }

      let entry = merged.get(phone);
      if (!entry) {
        entry = { phone, companyName: r.companyName, cities: new Set(), slugs: new Set(), rows: [] };
        merged.set(phone, entry);
      }
      if (!entry.companyName && r.companyName) entry.companyName = r.companyName;
      if (entry.slugs.has(r.categorySlug)) duplicatePairs++;
      cities.forEach((c) => entry!.cities.add(c.name.ru));
      entry.slugs.add(r.categorySlug);
      entry.rows.push(line);
    });

    const existingPhones = new Set(
      (
        await this.prisma.user.findMany({
          where: { phone: { in: [...merged.keys()] }, supplierProfile: { isNot: null } },
          select: { phone: true },
        })
      ).map((u) => u.phone),
    );

    const willCreate = [...merged.values()].filter((m) => !existingPhones.has(m.phone));
    const willUpdate = [...merged.values()].filter((m) => existingPhones.has(m.phone));

    if (!dryRun) {
      for (const m of merged.values()) {
        await this.upsertSupplier(
          {
            phone: m.phone,
            companyName: m.companyName,
            categorySlugs: [...m.slugs],
            cities: [...m.cities],
          },
          admin,
        );
      }
    }

    return {
      dryRun,
      rowsIn: dto.rows.length,
      suppliers: merged.size,
      willCreate: willCreate.length,
      willUpdate: willUpdate.length,
      duplicatePairs,
      rejected,
      byCategory: [...merged.values()]
        .flatMap((m) => [...m.slugs])
        .reduce<Record<string, number>>((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {}),
      preview: [...merged.values()].slice(0, 10).map((m) => ({
        phone: m.phone,
        companyName: m.companyName ?? "",
        cities: [...m.cities],
        categories: [...m.slugs],
      })),
    };
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
