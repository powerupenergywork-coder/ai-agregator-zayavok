import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import {
  CategoryField,
  ORDER_STATUS_LABELS_RU,
  ORDER_STATUS_TRANSITIONS,
  OrderStatus,
} from "@ai-zayavki/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CategoriesService } from "../categories/categories.service";
import { AI_PROVIDER, AiProvider, AiUnavailableError, CLASSIFY_CONFIDENCE_THRESHOLD } from "../ai/ai.types";
import {
  calculateProgressPercent,
  missingRequiredFields,
  nextQuestionFields,
} from "../ai/field-completion.util";
import { STORAGE_PROVIDER, StorageProvider } from "../storage/storage-provider.interface";
import { NotificationsService } from "../notifications/notifications.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { assertTransition } from "../common/state-machine/state-machine.util";
import { env } from "../config/env";
import { AuthUser } from "../auth-otp/jwt-auth.guard";
import { buildQuestionText, deriveDenormalizedColumns, READY_FOR_REVIEW_MESSAGE } from "./order-derive.util";
import { CancelOrderDto } from "./dto/cancel-order.dto";
import { OrderDto } from "./order.dto";

export interface ChatTurnResponse {
  order: OrderDto;
  assistantMessage: string;
  needsCategoryPick: boolean;
  categories?: { slug: string; name: string; examples: string[] }[];
  nextFields: CategoryField[];
  isReadyForReview: boolean;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly notifications: NotificationsService,
    private readonly analytics: AnalyticsService,
    private readonly realtime: RealtimeGateway,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @InjectQueue("matching") private readonly matchingQueue: Queue,
  ) {}

  // ---------- draft lifecycle ----------

  async createDraft(categorySlug?: string, urgent = false) {
    let categoryId: string | undefined;
    if (categorySlug) {
      const category = await this.prisma.category.findUnique({ where: { slug: categorySlug } });
      if (category) categoryId = category.id;
    }
    const order = await this.prisma.order.create({
      data: { categoryId, urgent, status: categoryId ? "CLARIFYING" : "DRAFT" },
    });
    return this.toDto(order.id);
  }

  async chat(orderId: string, message: string): Promise<ChatTurnResponse> {
    const order = await this.getRawOrThrow(orderId);
    this.assertEditable(order);
    await this.prisma.chatMessage.create({ data: { orderId, role: "USER", content: message } });

    let categoryRow = order.categoryId ? await this.categories.findByIdOrThrow(order.categoryId) : null;

    if (!categoryRow) {
      const allCategories = await this.categories.listForClassification();
      let classification;
      try {
        classification = await this.ai.classify(message, allCategories);
      } catch (err) {
        if (err instanceof AiUnavailableError) {
          return this.respondNeedsCategoryPick(orderId, allCategories);
        }
        throw err;
      }
      if (!classification || classification.confidence < CLASSIFY_CONFIDENCE_THRESHOLD) {
        return this.respondNeedsCategoryPick(orderId, allCategories);
      }
      categoryRow = await this.prisma.category.findUniqueOrThrow({ where: { slug: classification.slug } });
      if (order.status === "DRAFT") {
        await this.transitionStatus(orderId, "CLARIFYING", "client");
      }
      await this.prisma.order.update({ where: { id: orderId }, data: { categoryId: categoryRow.id } });
    }

    const fields = categoryRow.fields as unknown as CategoryField[];
    const knownFields = (order.fieldsData ?? {}) as Record<string, unknown>;

    let extracted: Record<string, unknown> = {};
    try {
      extracted = await this.ai.extractFields(message, fields, knownFields);
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
      // Degrade gracefully: skip extraction this turn, still ask the next
      // question deterministically from the template.
    }

    return this.applyFieldUpdate(orderId, categoryRow, { ...knownFields, ...extracted });
  }

  async pickCategory(orderId: string, categorySlug: string): Promise<ChatTurnResponse> {
    const order = await this.getRawOrThrow(orderId);
    this.assertEditable(order);
    const category = await this.prisma.category.findUnique({ where: { slug: categorySlug } });
    if (!category) throw new NotFoundException("Категория не найдена");

    if (order.status === "DRAFT") {
      await this.transitionStatus(orderId, "CLARIFYING", "client");
    }
    await this.prisma.order.update({ where: { id: orderId }, data: { categoryId: category.id } });

    return this.applyFieldUpdate(orderId, category, (order.fieldsData ?? {}) as Record<string, unknown>);
  }

  async setField(orderId: string, key: string, value: unknown): Promise<ChatTurnResponse> {
    const order = await this.getRawOrThrow(orderId);
    this.assertEditable(order);
    if (!order.categoryId) throw new BadRequestException("Сначала определите категорию заявки");
    const category = await this.categories.findByIdOrThrow(order.categoryId);
    const fields = category.fields as unknown as CategoryField[];
    if (!fields.some((f) => f.key === key)) {
      throw new BadRequestException(`Неизвестное поле: ${key}`);
    }
    const knownFields = { ...((order.fieldsData ?? {}) as Record<string, unknown>), [key]: value };
    return this.applyFieldUpdate(orderId, category, knownFields);
  }

  async addPhoto(orderId: string, buffer: Buffer, filename: string, mimeType: string) {
    const order = await this.getRawOrThrow(orderId);
    this.assertEditable(order);
    const url = await this.storage.upload(buffer, filename, mimeType);
    await this.prisma.photo.create({ data: { orderId, url } });
    return this.toDto(orderId);
  }

  private async respondNeedsCategoryPick(
    orderId: string,
    categories: { slug: string; name: string; examples: string[] }[],
  ): Promise<ChatTurnResponse> {
    const assistantMessage =
      "Не получилось точно определить категорию. Выберите подходящий вариант, и я продолжу оформление:";
    await this.prisma.chatMessage.create({ data: { orderId, role: "ASSISTANT", content: assistantMessage } });
    return {
      order: await this.toDto(orderId),
      assistantMessage,
      needsCategoryPick: true,
      categories,
      nextFields: [],
      isReadyForReview: false,
    };
  }

  private async applyFieldUpdate(
    orderId: string,
    category: { id: string; fields: unknown },
    mergedFields: Record<string, unknown>,
  ): Promise<ChatTurnResponse> {
    const fields = category.fields as unknown as CategoryField[];
    const progress = calculateProgressPercent(fields, mergedFields);
    const missing = nextQuestionFields(fields, mergedFields);
    const derived = deriveDenormalizedColumns(fields, mergedFields);

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        fieldsData: mergedFields as any,
        progressPercent: progress,
        addressFrom: derived.addressFrom,
        addressTo: derived.addressTo,
        city: derived.city,
        dateNeeded: derived.dateNeeded,
        timeWindow: derived.timeWindow,
      },
    });

    const assistantMessage = missing.length === 0 ? READY_FOR_REVIEW_MESSAGE : buildQuestionText(missing);
    await this.prisma.chatMessage.create({ data: { orderId, role: "ASSISTANT", content: assistantMessage } });

    return {
      order: await this.toDto(orderId),
      assistantMessage,
      needsCategoryPick: false,
      nextFields: missing,
      isReadyForReview: missing.length === 0,
    };
  }

  // ---------- publish / status ----------

  async publish(orderId: string, user: AuthUser) {
    if (user.role !== "client") throw new ForbiddenException("Доступно только клиенту");
    const order = await this.getRawOrThrow(orderId);
    if (order.clientId && order.clientId !== user.profileId) {
      throw new ForbiddenException("Заявка принадлежит другому клиенту");
    }
    if (!["DRAFT", "CLARIFYING"].includes(order.status)) {
      throw new BadRequestException("Заявку нельзя опубликовать в текущем статусе");
    }
    if (!order.categoryId) throw new BadRequestException("Сначала определите категорию");

    const category = await this.categories.findByIdOrThrow(order.categoryId);
    const fields = category.fields as unknown as CategoryField[];
    const missing = missingRequiredFields(fields, (order.fieldsData ?? {}) as Record<string, unknown>);
    if (missing.length > 0) {
      throw new BadRequestException("Не все обязательные поля заполнены");
    }

    await this.prisma.order.update({ where: { id: orderId }, data: { clientId: user.profileId } });
    await this.transitionStatus(orderId, "AWAITING_PHONE_CONFIRMATION", "client");
    await this.prisma.order.update({ where: { id: orderId }, data: { publishedAt: new Date() } });
    await this.transitionStatus(orderId, "PUBLISHED", "client");

    const dto = await this.toDto(orderId);
    await this.notifications.send({
      event: "order_published",
      payload: { orderNumber: dto.number, statusUrl: `${env.webUrl}/orders/${dto.id}` },
      recipientPhone: user.phone,
      orderId,
    });
    await this.analytics.track("order_published", { orderId, userId: user.sub });
    await this.matchingQueue.add("start", { orderId });
    // Suppliers now contact the client directly, so nothing in the system
    // ever tells us the order is done — we have to proactively ask instead
    // of waiting for the client to come back and close it themselves.
    await this.matchingQueue.add("checkin", { orderId }, { delay: env.orderCheckinDelayHours * 3600 * 1000 });
    await this.matchingQueue.add(
      "checkin-escalate",
      { orderId },
      { delay: env.orderCheckinEscalateHours * 3600 * 1000 },
    );
    this.realtime.emitOrderUpdated(orderId, dto);

    return dto;
  }

  async cancel(orderId: string, user: AuthUser, dto: CancelOrderDto) {
    const order = await this.getRawOrThrow(orderId);
    this.assertOwnership(order, user);
    assertTransition(ORDER_STATUS_TRANSITIONS, order.status as OrderStatus, "CANCELLED_BY_CLIENT");

    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        data: { status: "CANCELLED_BY_CLIENT", cancelledAt: new Date(), cancelReason: dto.reason },
      }),
      this.prisma.orderStatusEvent.create({
        data: { orderId, fromStatus: order.status, toStatus: "CANCELLED_BY_CLIENT", actor: "client", note: dto.comment },
      }),
    ]);

    await this.notifyDispatchedSuppliers(orderId, order.number, "order_cancelled");

    await this.analytics.track("order_cancelled", { orderId, userId: user.sub, metadata: { reason: dto.reason } });
    const result = await this.toDto(orderId);
    this.realtime.emitOrderUpdated(orderId, result);
    return result;
  }

  /** Client closes an active order — no specific supplier is tracked, so this
   * is the one action that ends it: either done (COMPLETED) or it didn't work
   * out (NEEDS_OPERATOR, so an operator can follow up). */
  async completeOrder(orderId: string, user: AuthUser, positive: boolean, comment?: string) {
    const order = await this.getRawOrThrow(orderId);
    this.assertOwnership(order, user);
    if (order.status !== "PUBLISHED") {
      throw new BadRequestException("Завершить можно только активную заявку");
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { clientRatingPositive: positive, clientRatingComment: comment },
    });

    if (positive) {
      await this.transitionStatus(orderId, "COMPLETED", "client");
      await this.prisma.order.update({ where: { id: orderId }, data: { completedAt: new Date() } });
      await this.analytics.track("order_completed", { orderId, userId: user.sub });
    } else {
      const reason = "Клиент отметил, что услугу не оказали";
      await this.transitionStatus(orderId, "NEEDS_OPERATOR", "client", reason);
      await this.notifications.send({ event: "needs_operator", payload: { orderNumber: order.number, reason }, orderId });
    }

    const dto = await this.toDto(orderId);
    this.realtime.emitOrderUpdated(orderId, dto);
    return dto;
  }

  /** Proactive nudge — fired ORDER_CHECKIN_DELAY_HOURS after publish. No-op if
   * the client already closed the order (or it's stuck in NEEDS_OPERATOR)
   * by the time the delayed job runs. */
  async sendCompletionCheckin(orderId: string) {
    const order = await this.getRawOrThrow(orderId);
    if (order.status !== "PUBLISHED" || !order.clientId) return;

    const client = await this.prisma.clientProfile.findUnique({
      where: { id: order.clientId },
      include: { user: true },
    });
    if (!client) return;
    const category = order.categoryId ? await this.categories.findByIdOrThrow(order.categoryId) : null;

    await this.notifications.send({
      event: "completion_checkin",
      payload: {
        orderNumber: order.number,
        categoryName: category?.name ?? "услуга",
        orderUrl: `${env.webUrl}/orders/${orderId}`,
      },
      recipientPhone: client.user.phone,
      orderId,
      buttons: [
        { id: `complete|yes|${orderId}`, text: "Да, всё хорошо" },
        { id: `complete|no|${orderId}`, text: "Нет, не получилось" },
      ],
    });
  }

  /** Fired ORDER_CHECKIN_ESCALATE_HOURS after publish — if the client never
   * responded to the check-in (order is still PUBLISHED), hand it to an
   * operator rather than leaving it to sit forever. */
  async escalateStaleOrder(orderId: string) {
    const order = await this.getRawOrThrow(orderId);
    if (order.status !== "PUBLISHED") return;

    const reason = "Клиент не ответил на проверку статуса заявки";
    await this.transitionStatus(orderId, "NEEDS_OPERATOR", "system", reason);
    await this.notifications.send({ event: "needs_operator", payload: { orderNumber: order.number, reason }, orderId });
    this.realtime.emitOrderUpdated(orderId, await this.toDto(orderId));
  }

  async repeat(orderId: string, user: AuthUser) {
    const source = await this.getRawOrThrow(orderId);
    this.assertOwnership(source, user);
    if (source.status !== "COMPLETED") {
      throw new BadRequestException("Повторить можно только завершённую заявку");
    }
    const created = await this.prisma.order.create({
      data: {
        clientId: user.profileId,
        categoryId: source.categoryId,
        fieldsData: source.fieldsData as any,
        addressFrom: source.addressFrom,
        addressTo: source.addressTo,
        city: source.city,
        district: source.district,
        status: "CLARIFYING",
        progressPercent: source.progressPercent,
        repeatOfOrderId: source.id,
      },
    });
    await this.analytics.track("repeat_order_created", {
      orderId: created.id,
      userId: user.sub,
      metadata: { sourceOrderId: source.id },
    });
    return this.toDto(created.id);
  }

  async listMine(user: AuthUser) {
    const orders = await this.prisma.order.findMany({
      where: { clientId: user.profileId },
      orderBy: { createdAt: "desc" },
      include: { category: true },
    });
    return orders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      statusLabel: ORDER_STATUS_LABELS_RU[o.status as OrderStatus],
      categoryName: o.category?.name ?? null,
      createdAt: o.createdAt,
    }));
  }

  // ---------- shared helpers used by other modules ----------

  async transitionStatus(orderId: string, to: OrderStatus, actor: string, note?: string) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    assertTransition(ORDER_STATUS_TRANSITIONS, order.status as OrderStatus, to);
    await this.prisma.$transaction([
      this.prisma.order.update({ where: { id: orderId }, data: { status: to } }),
      this.prisma.orderStatusEvent.create({
        data: { orderId, fromStatus: order.status, toStatus: to, actor, note },
      }),
    ]);
  }

  /** Notifies every supplier who was ever sent this order (across all dispatch
   * waves) — used when the client or an admin closes an order out from under
   * them, e.g. cancellation. Reused by AdminService.adminCancel(). */
  async notifyDispatchedSuppliers(orderId: string, orderNumber: number, event: "order_cancelled") {
    const waves = await this.prisma.dispatchWave.findMany({ where: { orderId } });
    const supplierIds = new Set<string>();
    for (const wave of waves) {
      for (const id of wave.supplierIds as string[]) supplierIds.add(id);
    }
    if (supplierIds.size === 0) return;

    const suppliers = await this.prisma.supplierProfile.findMany({
      where: { id: { in: Array.from(supplierIds) } },
      include: { user: true },
    });
    for (const supplier of suppliers) {
      await this.notifications.send({
        event,
        payload: { orderNumber },
        recipientPhone: supplier.user.phone,
        supplierId: supplier.id,
        orderId,
      });
    }
  }

  async getRawOrThrow(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException("Заявка не найдена");
    return order;
  }

  async getByPublicToken(token: string) {
    const order = await this.prisma.order.findUnique({ where: { publicToken: token } });
    if (!order) throw new NotFoundException("Заявка не найдена");
    return this.toDto(order.id);
  }

  private assertEditable(order: { status: string }) {
    if (!["DRAFT", "CLARIFYING"].includes(order.status)) {
      throw new BadRequestException("Заявка уже опубликована и недоступна для редактирования в чате");
    }
  }

  private assertOwnership(order: { clientId: string | null }, user: AuthUser) {
    if (!order.clientId || order.clientId !== user.profileId) {
      throw new ForbiddenException("Заявка принадлежит другому клиенту");
    }
  }

  async toDto(orderId: string): Promise<OrderDto> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        category: true,
        photos: true,
        chatMessages: { orderBy: { createdAt: "asc" } },
        client: { include: { user: true } },
        dispatchWaves: true,
      },
    });
    const notifiedSuppliersCount = new Set(
      order.dispatchWaves.flatMap((w) => w.supplierIds as string[]),
    ).size;
    return {
      id: order.id,
      number: order.number,
      publicToken: order.publicToken,
      status: order.status,
      statusLabel: ORDER_STATUS_LABELS_RU[order.status as OrderStatus],
      urgent: order.urgent,
      category: order.category
        ? {
            slug: order.category.slug,
            name: order.category.name,
            icon: order.category.icon,
            fields: order.category.fields as unknown as CategoryField[],
          }
        : null,
      fieldsData: order.fieldsData as Record<string, unknown>,
      progressPercent: order.progressPercent,
      addressFrom: order.addressFrom,
      addressTo: order.addressTo,
      city: order.city,
      dateNeeded: order.dateNeeded,
      timeWindow: order.timeWindow,
      photos: order.photos.map((p) => p.url),
      chatMessages: order.chatMessages.map((m) => ({
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
      // Suppliers see this order's card too (/s/:orderId) and it carries the
      // client's contact directly — that's how "lead broadcast" replaces
      // offer collection: suppliers call the client themselves.
      clientPhone: order.client?.user.phone ?? null,
      notifiedSuppliersCount,
      // Computed fresh on every read (not just chat-turn responses) so a
      // page reload mid-conversation still knows what to ask/show next.
      nextFields: order.category
        ? nextQuestionFields(order.category.fields as unknown as CategoryField[], order.fieldsData as Record<string, unknown>)
        : [],
      needsCategoryPick: !order.categoryId && order.chatMessages.some((m) => m.role === "USER"),
      clientRatingPositive: order.clientRatingPositive,
      publishedAt: order.publishedAt,
      completedAt: order.completedAt,
      cancelledAt: order.cancelledAt,
      cancelReason: order.cancelReason,
      createdAt: order.createdAt,
    };
  }
}
