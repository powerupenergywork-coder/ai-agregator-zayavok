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
import { formatFieldValue } from "../common/field-format.util";
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
      // Слова самого поставщика о своей технике — единственное, что отличает
      // «Автокран 25 т, стрела 42 м» от соседа с 10-тонником, а по категории
      // из справочника они неразличимы.
      selfDescription: s.selfDescription,
      selfDescriptionAt: s.selfDescriptionAt,
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
    // WHATSAPP, not the schema default of SMS: everything a supplier ever
    // does with us — the cold invite's "Интересно, беру", онбординг, «стоп»,
    // «мой профиль» — is a button or a reply in WhatsApp. Left on SMS, the
    // invite arrives as a wall of text with the buttons silently dropped and
    // nothing to reply to.
    const user = await this.prisma.user.upsert({
      where: { phone },
      create: { phone, preferredChannel: "WHATSAPP" },
      update: {},
    });
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

  /**
   * Вся денежная сторона одного поставщика в одном ответе: подписка, счета,
   * платежи.
   *
   * Раньше в админке из этого не было видно ничего — ни выставленных счетов,
   * ни прошедших платежей, — и на вопрос «я оплатил, почему не работает?»
   * ответить было нечем. Три сущности показываем рядом намеренно: ответ почти
   * всегда в стыке между ними — счёт выставлен, но не оплачен; платёж прошёл,
   * но на чужой номер; подписка кончилась вчера.
   */
  async supplierBilling(id: string) {
    const supplier = await this.prisma.supplierProfile.findUnique({
      where: { id },
      include: { subscription: true, user: true },
    });
    if (!supplier) throw new NotFoundException("Поставщик не найден");

    const [invoices, payments] = await Promise.all([
      this.prisma.subscriptionInvoice.findMany({
        where: { supplierId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      // Платежи ищем и по привязке к поставщику, и по номерам его счетов:
      // платёж, не нашедший счёт, к поставщику не привязан — а это ровно тот
      // случай, который и приходят разбирать.
      this.prisma.kaspiPayment.findMany({
        where: {
          OR: [
            { supplierId: id },
            { invoice: { supplierId: id } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    return {
      phone: supplier.user.phone,
      companyName: supplier.companyName,
      notificationsUsedThisMonth: supplier.notificationsUsedThisMonth,
      freeQuota: env.freeNotificationsPerMonth,
      subscription: {
        active: this.billing.isSubscriptionActive(supplier.subscription),
        status: supplier.subscription?.status ?? "NONE",
        currentPeriodEnd: supplier.subscription?.currentPeriodEnd ?? null,
        paymentProvider: supplier.subscription?.paymentProvider ?? null,
      },
      invoices: invoices.map((i) => ({
        number: i.number,
        amountTenge: i.amountTenge,
        periodDays: i.periodDays,
        status: i.status,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
        paidAt: i.paidAt,
      })),
      payments: payments.map((p) => ({
        txnId: p.txnId,
        prvTxnId: p.prvTxnId,
        account: p.account,
        sumTenge: p.sumTenge,
        txnDate: p.txnDate,
        result: p.result,
        comment: p.comment,
        daysGranted: p.daysGranted,
        createdAt: p.createdAt,
      })),
    };
  }

  /** Счёт по просьбе поставщика, до всякого лимита. */
  async issueInvoice(id: string, admin: AdminAuthUser) {
    const supplier = await this.prisma.supplierProfile.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException("Поставщик не найден");
    const invoice = await this.billing.issueInvoice(id);
    await this.audit.log({
      actorType: admin.role === "ADMIN" ? "admin" : "operator",
      actorId: admin.sub,
      action: "issue_invoice",
      targetType: "SubscriptionInvoice",
      targetId: invoice.id,
    });
    return { number: invoice.number, amountTenge: invoice.amountTenge, periodDays: invoice.periodDays };
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
      channel: o.channel,
      notifiedSuppliersCount: new Set(o.dispatchWaves.flatMap((w) => w.supplierIds as string[])).size,
      clientPhone: o.client?.user.phone ?? null,
      createdAt: o.createdAt,
      publishedAt: o.publishedAt,
    }));
  }

  /**
   * Полное содержание заявки для админки.
   *
   * Список даёт только шапку — номер, категорию, город, — и по ней нельзя
   * понять, что человек вообще просил. Здесь поля с человеческими названиями,
   * переписка и то, кому и с каким исходом ушла рассылка: этого хватает, чтобы
   * разобрать жалобу, не открывая базу.
   *
   * Значения приводятся к строкам тем же форматтером, что и сообщения
   * поставщикам, — чтобы в админке было ровно то, что увидел исполнитель, а не
   * сырой JSON с «unknown» и «needs_consultation».
   */
  async orderDetails(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        category: true,
        client: { include: { user: true } },
        chatMessages: { orderBy: { createdAt: "asc" } },
        statusHistory: { orderBy: { createdAt: "asc" } },
        photos: true,
        dispatchWaves: true,
      },
    });
    if (!order) throw new NotFoundException("Заявка не найдена");

    const categoryFields = ((order.category?.fields as unknown as CategoryField[]) ?? []).filter(
      (f) => f.type !== "photo",
    );
    const data = (order.fieldsData ?? {}) as Record<string, unknown>;
    const fields = categoryFields
      .filter((f) => data[f.key] !== undefined)
      .map((f) => ({ label: f.label.ru, value: formatFieldValue(data[f.key], f, "ru") }));

    // Поля, которые человек назвал, но которых нет в шаблоне категории (или
    // категория ещё не определена) — иначе они просто пропали бы из виду.
    const knownKeys = new Set(categoryFields.map((f) => f.key));
    const extraFields = Object.entries(data)
      .filter(([key]) => !knownKeys.has(key))
      .map(([key, value]) => ({ label: key, value: String(value) }));

    const supplierIds = [...new Set(order.dispatchWaves.flatMap((w) => w.supplierIds as string[]))];
    const notifications = await this.prisma.notificationLog.findMany({
      where: { orderId },
      select: {
        id: true,
        templateKey: true,
        recipientPhone: true,
        status: true,
        errorMessage: true,
        deliveredAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return {
      id: order.id,
      number: order.number,
      status: order.status,
      statusLabel: ORDER_STATUS_LABELS_RU[order.status as OrderStatus],
      categoryName: order.category ? (order.category.name as unknown as LocalizedText).ru : null,
      city: order.city,
      urgent: order.urgent,
      channel: order.channel,
      addressFrom: order.addressFrom,
      addressTo: order.addressTo,
      dateNeeded: order.dateNeeded,
      timeWindow: order.timeWindow,
      clientPhone: order.client?.user.phone ?? null,
      source: order.source,
      landingPath: order.landingPath,
      createdAt: order.createdAt,
      publishedAt: order.publishedAt,
      cancelReason: order.cancelReason,
      fields: [...fields, ...extraFields],
      photos: order.photos.map((p) => p.url),
      chat: order.chatMessages.map((m) => ({ role: m.role, content: m.content, at: m.createdAt })),
      statusHistory: order.statusHistory.map((e) => ({
        status: e.toStatus,
        actor: e.actor,
        reason: e.note,
        at: e.createdAt,
      })),
      notifiedSuppliersCount: supplierIds.length,
      notifications,
    };
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

  // ---------- качество: где застревают и что не поняли ----------

  /**
   * Воронка и «залипшие» заявки одним запросом.
   *
   * Воронка считается по фактам в самой заявке, а не по счётчику событий:
   * счётчик врёт при любой смене логики задним числом, а publishedAt и статус
   * — это то, что произошло на самом деле.
   */
  async insights() {
    const now = Date.now();
    const minutesAgo = (m: number) => new Date(now - m * 60 * 1000);

    const [total, withCategory, reachedConfirm, published, completed, cancelled, noSuppliers] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.order.count({ where: { categoryId: { not: null } } }),
      this.prisma.order.count({
        where: { OR: [{ status: "AWAITING_PHONE_CONFIRMATION" }, { publishedAt: { not: null } }] },
      }),
      this.prisma.order.count({ where: { publishedAt: { not: null } } }),
      this.prisma.order.count({ where: { status: "COMPLETED" } }),
      this.prisma.order.count({ where: { status: { in: ["CANCELLED_BY_CLIENT", "CANCELLED_BY_ADMIN"] } } }),
      this.prisma.order.count({ where: { status: "NEEDS_OPERATOR" } }),
    ]);

    // Пороги подобраны так, чтобы не считать «залипшим» того, кто просто
    // сейчас печатает: заполнение занимает минуты, а не полчаса.
    const [stuckClarifying, stuckAwaiting, stuckPublished] = await Promise.all([
      // Вместе с заявкой тянем хвост переписки: без него список — это столбик
      // номеров, по которому нельзя понять, на чём человек сорвался. Последний
      // вопрос бота и последний ответ клиента отвечают на это сразу, без
      // открытия каждой заявки по очереди.
      this.prisma.order.findMany({
        where: { status: "CLARIFYING", createdAt: { lt: minutesAgo(30) } },
        select: {
          id: true,
          number: true,
          city: true,
          createdAt: true,
          fieldsData: true,
          chatMessages: { orderBy: { createdAt: "desc" }, take: 4, select: { role: true, content: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      this.prisma.order.findMany({
        where: { status: "AWAITING_PHONE_CONFIRMATION", createdAt: { lt: minutesAgo(60) } },
        select: {
          id: true,
          number: true,
          city: true,
          createdAt: true,
          chatMessages: { orderBy: { createdAt: "desc" }, take: 4, select: { role: true, content: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      this.prisma.order.findMany({
        where: { status: "PUBLISHED", publishedAt: { lt: minutesAgo(24 * 60) } },
        select: { id: true, number: true, city: true, publishedAt: true },
        orderBy: { publishedAt: "desc" },
        take: 50,
      }),
    ]);

    // Недоставленное: раньше отказ Меты жил только в логах контейнера.
    const failedDelivery = await this.prisma.notificationLog.findMany({
      where: { status: "FAILED", createdAt: { gt: minutesAgo(7 * 24 * 60) } },
      select: { id: true, templateKey: true, recipientPhone: true, errorMessage: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const unrecognized = await this.prisma.whatsAppMessage.findMany({
      where: { unrecognized: true },
      select: { id: true, phone: true, text: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // Источник считаем не по всем заявкам, а по дошедшим до публикации: канал,
    // который гонит брошенные черновики, и канал, который приносит настоящие
    // заказы, — это разные вещи, и в отчёте их надо видеть рядом.
    const [bySourceAll, bySourcePublished] = await Promise.all([
      this.prisma.order.groupBy({ by: ["source"], _count: { _all: true } }),
      this.prisma.order.groupBy({
        by: ["source"],
        where: { publishedAt: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const publishedBySource = new Map(bySourcePublished.map((r) => [r.source ?? "—", r._count._all]));
    const sources = bySourceAll
      .map((r) => ({
        source: r.source ?? "—",
        orders: r._count._all,
        published: publishedBySource.get(r.source ?? "—") ?? 0,
      }))
      .sort((a, b) => b.orders - a.orders);

    const supplierFunnel = await this.supplierFunnel();

    // Из хвоста переписки достаём именно пару «последний вопрос — последний
    // ответ»: она и показывает, на каком месте разговор оборвался.
    const withTail = <T extends { chatMessages: { role: string; content: string }[] }>(o: T) => {
      const { chatMessages, ...rest } = o;
      return {
        ...rest,
        lastQuestion: chatMessages.find((m) => m.role === "ASSISTANT")?.content ?? null,
        lastAnswer: chatMessages.find((m) => m.role === "USER")?.content ?? null,
      };
    };

    return {
      funnel: { total, withCategory, reachedConfirm, published, completed, cancelled, noSuppliers },
      sources,
      stuck: {
        clarifying: stuckClarifying.map(withTail),
        awaitingConfirm: stuckAwaiting.map(withTail),
        publishedNoResult: stuckPublished,
      },
      failedDelivery,
      unrecognized,
      supplierFunnel,
    };
  }

  /**
   * Воронка по поставщикам: что стало с холодным приглашением на каждом шаге.
   *
   * Воронка по заявкам показывает только сторону клиента, а половина потерь
   * сервиса живёт на стороне исполнителя — приглашение не дошло, дошло и не
   * прочитано, прочитано и проигнорировано, человек ответил текстом вместо
   * кнопки. Все четыре случая до сих пор выглядели одинаково: «не подтвердил».
   *
   * Отдельно выносим тех, кто написал текстом: это не статистика, а список
   * людей, которым нужен живой ответ, — с них началась вся эта переделка.
   */
  private async supplierFunnel() {
    const [suppliers, invited, delivered, read, failed, sentCounts, inbound] = await Promise.all([
      this.prisma.supplierProfile.findMany({
        select: {
          id: true,
          companyName: true,
          confirmedAt: true,
          isBlocked: true,
          selfDescription: true,
          user: { select: { phone: true } },
        },
      }),
      this.prisma.notificationLog.groupBy({
        by: ["supplierId"],
        where: { templateKey: "supplier_cold_invite", supplierId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.notificationLog.groupBy({
        by: ["supplierId"],
        where: { templateKey: "supplier_cold_invite", supplierId: { not: null }, deliveredAt: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.notificationLog.groupBy({
        by: ["supplierId"],
        where: { templateKey: "supplier_cold_invite", supplierId: { not: null }, readAt: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.notificationLog.groupBy({
        by: ["supplierId"],
        where: { templateKey: "supplier_cold_invite", supplierId: { not: null }, status: "FAILED" },
        _count: { _all: true },
      }),
      // Сколько дошедших приглашений у каждого — по этому считаем, кому мы
      // больше не пишем (см. MatchingService.mayInviteAgain). Без этой строки
      // человек просто пропадает из рассылки без объяснения.
      this.prisma.notificationLog.groupBy({
        by: ["supplierId"],
        where: { templateKey: "supplier_cold_invite", supplierId: { not: null }, status: { not: "FAILED" } },
        _count: { _all: true },
      }),
      // Стенограмма живёт 7 дней (см. transcript-retention.service.ts), так
      // что «написал текстом» и «молчит» — это всегда про последнюю неделю.
      // Подписи в интерфейсе говорят об этом прямо: иначе цифру прочитают
      // как «за всё время» и сделают неверный вывод.
      //
      // distinct по номеру, а не выборка всей переписки в память: нужно ровно
      // одно последнее текстовое сообщение с каждого номера, и объём ответа
      // должен зависеть от числа собеседников, а не от их разговорчивости.
      this.prisma.whatsAppMessage.findMany({
        where: { direction: "IN", kind: { not: "button_reply" } },
        distinct: ["phone"],
        select: { phone: true, text: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const tappedRows = await this.prisma.whatsAppMessage.groupBy({
      by: ["phone"],
      where: { direction: "IN", kind: "button_reply" },
      _count: { _all: true },
    });

    const setOf = (rows: { supplierId: string | null }[]) =>
      new Set(rows.map((r) => r.supplierId).filter((id): id is string => !!id));
    const invitedIds = setOf(invited);
    const deliveredIds = setOf(delivered);
    const readIds = setOf(read);
    const failedIds = setOf(failed);

    // Последнее текстовое сообщение с номера — именно оно нужно оператору,
    // чтобы понять, о чём человек спрашивает.
    const lastText = new Map(inbound.map((m) => [m.phone, { text: m.text, createdAt: m.createdAt }]));
    const tapped = new Set(tappedRows.map((r) => r.phone));

    const sentPerSupplier = new Map(
      sentCounts.map((r) => [r.supplierId as string, r._count._all]),
    );

    let confirmed = 0;
    let declined = 0;
    let silent = 0;
    let exhausted = 0;
    const wroteText: {
      id: string;
      phone: string;
      companyName: string | null;
      confirmed: boolean;
      text: string | null;
      at: Date;
      selfDescription: string | null;
    }[] = [];

    for (const s of suppliers) {
      const phone = s.user.phone;
      if (s.confirmedAt) confirmed++;
      if (s.isBlocked) declined++;

      const wrote = lastText.get(phone);
      if (wrote) {
        wroteText.push({
          id: s.id,
          phone,
          companyName: s.companyName,
          confirmed: !!s.confirmedAt,
          text: wrote.text,
          at: wrote.createdAt,
          selfDescription: s.selfDescription,
        });
      }
      // Молчит — это доставленное приглашение без единого ответа. Недошедшее
      // сюда не попадает: там виноваты мы, а не человек, и лечится это
      // другим — разбором ошибки доставки, а не повторной рассылкой.
      if (deliveredIds.has(s.id) && !tapped.has(phone) && !wrote && !s.confirmedAt) silent++;
      // Исчерпал попытки — больше приглашений не получит, даже если появится
      // подходящая заявка (MatchingService.mayInviteAgain). Считаем только
      // среди неподтверждённых: у согласившихся приглашения кончились по
      // хорошей причине.
      if (!s.confirmedAt && (sentPerSupplier.get(s.id) ?? 0) >= env.supplierInviteMaxAttempts) exhausted++;
    }

    wroteText.sort((a, b) => b.at.getTime() - a.at.getTime());

    return {
      inBase: suppliers.length,
      invited: invitedIds.size,
      delivered: deliveredIds.size,
      read: readIds.size,
      failed: failedIds.size,
      confirmed,
      declined,
      silent,
      exhausted,
      maxAttempts: env.supplierInviteMaxAttempts,
      wroteText: wroteText.slice(0, 50),
    };
  }

  /**
   * Одна лента переписки по номеру: что человек написал, что ушло ему и чем
   * закончилась доставка. Стенограмма и журнал уведомлений живут в разных
   * таблицах намеренно — первая это сырьё, вторая деловая запись с привязкой
   * к заявке, — поэтому сводим их здесь, а не дублируем в базе.
   */
  /**
   * Список диалогов — вход в переписку, которого не было.
   *
   * Лента по номеру существовала и раньше, но открыть её можно было, только
   * зная номер наизусть. То есть посмотреть, как бот разговаривает с людьми,
   * было нельзя: чтобы найти разговор, надо было сначала знать, что он есть.
   *
   * Порядок по последнему сообщению, а не по числу: разбирают всегда свежее.
   * Рядом с каждым — признаки, ради которых сюда и заходят: человек писал
   * текстом (значит кнопок ему не хватило) и бот чего-то не понял.
   */
  async conversations(filter?: string) {
    const [byDirection, lastMessages, unrecognized, humanText] = await Promise.all([
      this.prisma.whatsAppMessage.groupBy({ by: ["phone", "direction"], _count: { _all: true } }),
      this.prisma.whatsAppMessage.findMany({
        distinct: ["phone"],
        orderBy: { createdAt: "desc" },
        select: { phone: true, direction: true, kind: true, text: true, payload: true, createdAt: true },
      }),
      this.prisma.whatsAppMessage.groupBy({
        by: ["phone"],
        where: { unrecognized: true },
        _count: { _all: true },
      }),
      // Свободный текст от человека, а не нажатие кнопки: именно он означает,
      // что предложенных вариантов не хватило.
      this.prisma.whatsAppMessage.groupBy({
        by: ["phone"],
        where: { direction: "IN", kind: { notIn: ["button_reply"] } },
        _count: { _all: true },
      }),
    ]);

    const phones = [...new Set(byDirection.map((r) => r.phone))];
    const users = await this.prisma.user.findMany({
      where: { phone: { in: phones } },
      select: {
        phone: true,
        supplierProfile: { select: { companyName: true, confirmedAt: true, isBlocked: true } },
        clientProfile: { select: { id: true } },
      },
    });

    const userByPhone = new Map(users.map((u) => [u.phone, u]));
    const inCount = new Map<string, number>();
    const outCount = new Map<string, number>();
    for (const r of byDirection) {
      (r.direction === "IN" ? inCount : outCount).set(r.phone, r._count._all);
    }
    const unrecByPhone = new Map(unrecognized.map((r) => [r.phone, r._count._all]));
    const textByPhone = new Map(humanText.map((r) => [r.phone, r._count._all]));
    const lastByPhone = new Map(lastMessages.map((m) => [m.phone, m]));

    let rows = phones.map((phone) => {
      const u = userByPhone.get(phone);
      const last = lastByPhone.get(phone);
      const sup = u?.supplierProfile;
      return {
        phone,
        name: sup?.companyName ?? (u?.clientProfile ? "клиент" : null),
        role: sup ? "supplier" : u?.clientProfile ? "client" : "unknown",
        confirmed: sup ? !!sup.confirmedAt : null,
        blocked: sup?.isBlocked ?? null,
        lastAt: last?.createdAt ?? null,
        lastFrom: last?.direction === "IN" ? "human" : "bot",
        lastText: last ? (last.text ?? last.payload ?? `[${last.kind}]`) : "",
        inCount: inCount.get(phone) ?? 0,
        outCount: outCount.get(phone) ?? 0,
        humanTextCount: textByPhone.get(phone) ?? 0,
        unrecognizedCount: unrecByPhone.get(phone) ?? 0,
      };
    });

    if (filter === "text") rows = rows.filter((r) => r.humanTextCount > 0);
    if (filter === "unrecognized") rows = rows.filter((r) => r.unrecognizedCount > 0);
    if (filter === "silent") rows = rows.filter((r) => r.inCount === 0);

    rows.sort((a, b) => (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0));
    return {
      retentionDays: env.whatsappTranscriptRetentionDays,
      total: rows.length,
      rows: rows.slice(0, 200),
    };
  }

  async conversation(rawPhone: string) {
    const phone = normalizePhone(rawPhone);
    const [messages, notifications] = await Promise.all([
      this.prisma.whatsAppMessage.findMany({
        where: { phone },
        orderBy: { createdAt: "asc" },
        take: 500,
      }),
      this.prisma.notificationLog.findMany({
        where: { recipientPhone: phone },
        select: {
          id: true,
          templateKey: true,
          status: true,
          errorMessage: true,
          deliveredAt: true,
          readAt: true,
          createdAt: true,
          orderId: true,
        },
        orderBy: { createdAt: "asc" },
        take: 500,
      }),
    ]);

    const timeline = [
      ...messages.map((m) => ({
        at: m.createdAt,
        type: m.direction === "IN" ? ("in" as const) : ("out" as const),
        kind: m.kind,
        text: m.text ?? m.payload ?? "",
        unrecognized: m.unrecognized,
      })),
      ...notifications.map((n) => ({
        at: n.createdAt,
        type: "delivery" as const,
        kind: n.templateKey,
        text:
          n.status === "FAILED"
            ? `не доставлено: ${n.errorMessage ?? "без пояснения"}`
            : n.readAt
              ? "прочитано"
              : n.deliveredAt
                ? "доставлено"
                : "принято провайдером",
        unrecognized: false,
        orderId: n.orderId,
      })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());

    return { phone, timeline };
  }
}
