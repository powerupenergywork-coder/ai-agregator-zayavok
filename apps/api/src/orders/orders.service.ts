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
  Language,
  LocalizedText,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TRANSITIONS,
  OrderStatus,
} from "@ai-zayavki/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CategoriesService } from "../categories/categories.service";
import { AI_PROVIDER, AiProvider, AiUnavailableError, CLASSIFY_CONFIDENCE_THRESHOLD } from "../ai/ai.types";
import {
  calculateProgressPercent,
  isValidFieldValue,
  matchUnknownValueKeyword,
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
import { buildQuestionText, deriveDenormalizedColumns, readyForReviewMessage } from "./order-derive.util";
import { formatWhen, fullDescription } from "../matching/matching-message.util";
import { toLang } from "../common/language.util";
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

  async chat(orderId: string, message: string, lang: Language = "ru"): Promise<ChatTurnResponse> {
    const order = await this.getRawOrThrow(orderId);
    this.assertEditable(order);
    await this.prisma.chatMessage.create({ data: { orderId, role: "USER", content: message } });

    let categoryRow = order.categoryId ? await this.categories.findByIdOrThrow(order.categoryId) : null;
    const categoryJustDetermined = !categoryRow;

    if (!categoryRow) {
      const allCategories = await this.categories.listForClassification();
      let classification;
      try {
        classification = await this.ai.classify(message, allCategories);
      } catch (err) {
        if (err instanceof AiUnavailableError) {
          return this.respondNeedsCategoryPick(orderId, allCategories, lang);
        }
        throw err;
      }
      if (!classification || classification.confidence < CLASSIFY_CONFIDENCE_THRESHOLD) {
        return this.respondNeedsCategoryPick(orderId, allCategories, lang);
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

    if (Object.keys(extracted).length === 0 && !categoryJustDetermined) {
      // AI unavailable (or found nothing) — if exactly one free-text field
      // is pending, just take the message as-is instead of silently
      // re-asking the same question forever. Text/address fields have no
      // chip alternative in WhatsApp, so without this the client's answer
      // has nowhere to go whenever the AI provider is down.
      // Skipped on the turn that just classified the category: that message
      // describes what the client needs, not an answer to a field prompt —
      // no question has been asked yet, so it must not get parroted into
      // whatever the first pending field happens to be (e.g. producing an
      // "address" equal to the category name itself).
      const pending = nextQuestionFields(fields, knownFields);
      const pendingTextFields = pending.filter((f) => f.type === "text" || f.type === "address");
      if (pendingTextFields.length === 1 && message.trim()) {
        extracted = { [pendingTextFields[0].key]: message.trim() };
      } else if (pending.length === 1 && pending[0].allowUnknown) {
        // Same "don't loop forever" concern as above, but for allowUnknown
        // number/text-with-escape-hatch fields: if the client's reply
        // matches one of the magic phrases the question's own hint text
        // told them to use ("не знаю"/"примерно"/"нужна консультация"),
        // accept it even if the AI provider is down or didn't recognize it.
        const keyword = matchUnknownValueKeyword(message);
        if (keyword) extracted = { [pending[0].key]: keyword };
      }
    }

    return this.applyFieldUpdate(orderId, categoryRow, { ...knownFields, ...extracted }, lang);
  }

  async pickCategory(orderId: string, categorySlug: string, lang: Language = "ru"): Promise<ChatTurnResponse> {
    const order = await this.getRawOrThrow(orderId);
    this.assertEditable(order);
    const category = await this.prisma.category.findUnique({ where: { slug: categorySlug } });
    if (!category) throw new NotFoundException("Категория не найдена");

    if (order.status === "DRAFT") {
      await this.transitionStatus(orderId, "CLARIFYING", "client");
    }
    await this.prisma.order.update({ where: { id: orderId }, data: { categoryId: category.id } });

    return this.applyFieldUpdate(orderId, category, (order.fieldsData ?? {}) as Record<string, unknown>, lang);
  }

  async setField(orderId: string, key: string, value: unknown, lang: Language = "ru"): Promise<ChatTurnResponse> {
    const order = await this.getRawOrThrow(orderId);
    this.assertEditable(order);
    if (!order.categoryId) throw new BadRequestException("Сначала определите категорию заявки");
    const category = await this.categories.findByIdOrThrow(order.categoryId);
    const fields = category.fields as unknown as CategoryField[];
    const field = fields.find((f) => f.key === key);
    if (!field) {
      throw new BadRequestException(`Неизвестное поле: ${key}`);
    }
    if (!isValidFieldValue(field, value)) {
      throw new BadRequestException(`Некорректное значение для поля «${field.label.ru}»`);
    }
    const knownFields = { ...((order.fieldsData ?? {}) as Record<string, unknown>), [key]: value };
    return this.applyFieldUpdate(orderId, category, knownFields, lang);
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
    lang: Language,
  ): Promise<ChatTurnResponse> {
    // Category names/examples here stay Russian regardless of lang — this is
    // the rare "AI couldn't confidently classify" fallback, sourced from
    // listForClassification() (which feeds the AI prompt and is deliberately
    // kept Russian-only, see categories.service.ts).
    const assistantMessage =
      lang === "kk"
        ? "Санатты дәл анықтай алмадық. Сәйкес нұсқаны таңдаңыз, мен рәсімдеуді жалғастырамын:"
        : "Не получилось точно определить категорию. Выберите подходящий вариант, и я продолжу оформление:";
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
    lang: Language = "ru",
  ): Promise<ChatTurnResponse> {
    const fields = category.fields as unknown as CategoryField[];
    // Defense in depth against AI extraction (chat/pickCategory path): an
    // LLM isn't guaranteed to return a clean number just because the prompt
    // asked for one — drop anything that doesn't match its field's declared
    // type instead of saving garbage, so the question just gets asked again.
    const validatedFields = Object.fromEntries(
      Object.entries(mergedFields).filter(([key, value]) => {
        const field = fields.find((f) => f.key === key);
        return !field || isValidFieldValue(field, value);
      }),
    );
    const progress = calculateProgressPercent(fields, validatedFields);
    const missing = nextQuestionFields(fields, validatedFields);
    const derived = deriveDenormalizedColumns(fields, validatedFields);

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        fieldsData: validatedFields as any,
        progressPercent: progress,
        addressFrom: derived.addressFrom,
        addressTo: derived.addressTo,
        city: derived.city,
        dateNeeded: derived.dateNeeded,
        timeWindow: derived.timeWindow,
      },
    });

    const assistantMessage = missing.length === 0 ? readyForReviewMessage(lang) : buildQuestionText(missing, lang);
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

  /** One-step publish — used only by the WhatsApp-native flow
   * (whatsapp-router.service.ts), where the phone is already proven by the
   * message having come from that WhatsApp number, so there's no separate
   * confirmation step to wait for. The web flow uses
   * requestPublishConfirmation()/confirmPublish() instead — see there for why. */
  async publish(orderId: string, user: AuthUser) {
    await this.prepareForPublish(orderId, user);
    return this.finalizePublish(orderId);
  }

  /** Web flow: a trusted-device session can silently mint a JWT with no
   * fresh touch of the client's phone at all, so publishing straight from
   * that alone would let a script spam real supplier notifications with
   * zero friction. This leaves the order in AWAITING_PHONE_CONFIRMATION and
   * requires an explicit tap on the "Подтвердить" button sent to the
   * client's WhatsApp (or, with no WhatsApp, a fallback SMS) before
   * finalizePublish() actually runs — see confirmPublish(). */
  async requestPublishConfirmation(orderId: string, user: AuthUser) {
    const { category, fields, order } = await this.prepareForPublish(orderId, user);
    const dto = await this.toDto(orderId);
    const lang = await this.getLangForPhone(user.phone);
    await this.notifications.send({
      event: "order_confirm_request",
      payload: {
        orderNumber: dto.number,
        categoryName: (category.name as unknown as LocalizedText)[lang],
        city: order.city ?? "",
        whenText: formatWhen(order, lang),
        fullDescription: fullDescription(order.fieldsData, fields, lang),
        confirmUrl: `${env.webUrl}/confirm/${order.publicToken}`,
      },
      recipientPhone: user.phone,
      orderId,
      buttons: [{ id: `confirm_publish|${orderId}`, text: lang === "kk" ? "Растау" : "Подтвердить" }],
    });
    return dto;
  }

  /** Completes what requestPublishConfirmation() started — called from the
   * "Подтвердить" WhatsApp button tap (whatsapp-router.service.ts). Keyed on
   * phone rather than a JWT: the tap arrives as a bare webhook payload with
   * no session of its own, and matching against the order's own client
   * phone is what actually proves it's the same person who requested it. */
  async confirmPublish(orderId: string, phone: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { client: { include: { user: true } } },
    });
    if (!order) throw new NotFoundException("Заявка не найдена");
    if (order.status !== "AWAITING_PHONE_CONFIRMATION") {
      throw new BadRequestException("Заявка уже подтверждена или недоступна для подтверждения");
    }
    if (order.client?.user.phone !== phone) {
      throw new ForbiddenException("Заявка принадлежит другому номеру");
    }
    return this.finalizePublish(orderId);
  }

  /** SMS-fallback path: no WhatsApp buttons on that channel, so
   * order_confirm_request's text carries a link built from the order's own
   * publicToken instead — unguessable and order-specific, so possessing it
   * (only ever delivered to the client's phone) is the confirmation proof,
   * same security model as getByPublicToken()'s supplier-facing read link. */
  async confirmPublishByToken(token: string) {
    const order = await this.prisma.order.findUnique({ where: { publicToken: token } });
    if (!order) throw new NotFoundException("Заявка не найдена");
    if (order.status !== "AWAITING_PHONE_CONFIRMATION") {
      throw new BadRequestException("Заявка уже подтверждена или недоступна для подтверждения");
    }
    return this.finalizePublish(order.id);
  }

  private async prepareForPublish(orderId: string, user: AuthUser) {
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
    return { order, category, fields };
  }

  private async finalizePublish(orderId: string) {
    const order = await this.getRawOrThrow(orderId);
    const category = await this.categories.findByIdOrThrow(order.categoryId!);
    const fields = category.fields as unknown as CategoryField[];

    await this.prisma.order.update({ where: { id: orderId }, data: { publishedAt: new Date() } });
    await this.transitionStatus(orderId, "PUBLISHED", "client");

    const dto = await this.toDto(orderId);
    const lang = await this.getLangForPhone(dto.clientPhone ?? undefined);
    await this.notifications.send({
      event: "order_published",
      payload: {
        orderNumber: dto.number,
        categoryName: (category.name as unknown as LocalizedText)[lang],
        city: order.city ?? "",
        whenText: formatWhen(order, lang),
        fullDescription: fullDescription(order.fieldsData, fields, lang),
        statusUrl: `${env.webUrl}/orders/${dto.id}`,
      },
      recipientPhone: dto.clientPhone ?? undefined,
      orderId,
    });
    await this.analytics.track("order_published", { orderId });
    await this.matchingQueue.add("start", { orderId });
    await this.scheduleCompletionCheckins(orderId);
    this.realtime.emitOrderUpdated(orderId, dto);

    return dto;
  }

  /** Suppliers now contact the client directly, so nothing in the system
   * ever tells us the order is done — we have to proactively ask instead of
   * waiting for the client to come back and close it themselves. Called from
   * publish() and again from AdminService.redispatch() — a redispatched
   * order needs its own fresh check-in window, not the original one (which
   * may have already fired a no-op against the since-changed status). */
  async scheduleCompletionCheckins(orderId: string) {
    await this.matchingQueue.add("checkin", { orderId }, { delay: env.orderCheckinDelayHours * 3600 * 1000 });
    await this.matchingQueue.add(
      "checkin-escalate",
      { orderId },
      { delay: env.orderCheckinEscalateHours * 3600 * 1000 },
    );
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
    const lang = toLang(client.user.preferredLanguage);
    const categoryName = category ? (category.name as unknown as LocalizedText)[lang] : lang === "kk" ? "қызмет" : "услуга";

    await this.notifications.send({
      event: "completion_checkin",
      payload: {
        orderNumber: order.number,
        categoryName,
        orderUrl: `${env.webUrl}/orders/${orderId}`,
      },
      recipientPhone: client.user.phone,
      orderId,
      buttons: [
        { id: `complete|yes|${orderId}`, text: lang === "kk" ? "Иә, бәрі жақсы" : "Да, всё хорошо" },
        { id: `complete|no|${orderId}`, text: lang === "kk" ? "Жоқ, болмады" : "Нет, не получилось" },
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
      statusLabel: ORDER_STATUS_LABELS[o.status as OrderStatus],
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

  private async getLangForPhone(phone?: string): Promise<Language> {
    if (!phone) return "ru";
    const user = await this.prisma.user.findUnique({ where: { phone }, select: { preferredLanguage: true } });
    return user ? toLang(user.preferredLanguage) : "ru";
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
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        category: true,
        photos: true,
        chatMessages: { orderBy: { createdAt: "asc" } },
        client: { include: { user: true } },
        dispatchWaves: true,
      },
    });
    if (!order) throw new NotFoundException("Заявка не найдена");
    const notifiedSuppliersCount = new Set(
      order.dispatchWaves.flatMap((w) => w.supplierIds as string[]),
    ).size;
    return {
      id: order.id,
      number: order.number,
      publicToken: order.publicToken,
      status: order.status,
      statusLabel: ORDER_STATUS_LABELS[order.status as OrderStatus],
      urgent: order.urgent,
      category: order.category
        ? {
            slug: order.category.slug,
            name: order.category.name as unknown as LocalizedText,
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
