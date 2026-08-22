import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import {
  CategoryField,
  Language,
  LocalizedText,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TRANSITIONS,
  OrderStatus,
  citySuggestions,
  isQuestionNotAnswer,
  resolveCity,
} from "@ai-zayavki/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CategoriesService } from "../categories/categories.service";
import { AI_PROVIDER, AiProvider, AiUnavailableError, CLASSIFY_CONFIDENCE_THRESHOLD } from "../ai/ai.types";
import {
  calculateProgressPercent,
  dropPastDateTimeFields,
  isValidFieldValue,
  matchUnknownValueKeyword,
  missingRequiredFields,
  nextQuestionFields,
} from "../ai/field-completion.util";
import { STORAGE_PROVIDER, StorageProvider } from "../storage/storage-provider.interface";
import { WHATSAPP_PROVIDER, WhatsAppProvider } from "../whatsapp/whatsapp-provider.interface";
import { NotificationsService } from "../notifications/notifications.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { assertTransition } from "../common/state-machine/state-machine.util";
import { env } from "../config/env";
import { AuthUser } from "../auth-otp/jwt-auth.guard";
import { AuthOtpService } from "../auth-otp/auth-otp.service";
import { buildQuestionText, deriveDenormalizedColumns, readyForReviewMessage } from "./order-derive.util";
import { NewOrderAlertService } from "./new-order-alert.service";
import { priceHintSentence } from "../categories/category-price-hints";

import { isDecentHourNow } from "../matching/quiet-hours.util";
import { formatWhen, fullDescription } from "../matching/matching-message.util";
import { formatFieldValue } from "../common/field-format.util";
import { toLang } from "../common/language.util";
import { normalizePhone, isValidPhone } from "../common/phone.util";
import { CancelOrderDto } from "./dto/cancel-order.dto";
import { OrderCompletionOutcome } from "./dto/complete-order.dto";
import { OrderDto } from "./order.dto";

/** Абзац с отбивкой, если строка непустая. Пустая вилка не должна оставлять
 *  в сообщении два пустых перевода строки. */
function withGap(text: string): string {
  return text ? `${text}\n\n` : "";
}

/** «1 исполнитель, 2 исполнителя, 5 исполнителей». Число в сообщении живое —
 *  «3 исполнитель» выглядит так, будто писал автомат, и обесценивает всё
 *  остальное сообщение. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

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
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly notifications: NotificationsService,
    private readonly analytics: AnalyticsService,
    private readonly realtime: RealtimeGateway,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @InjectQueue("matching") private readonly matchingQueue: Queue,
    private readonly authOtp: AuthOtpService,
    private readonly newOrderAlert: NewOrderAlertService,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
  ) {}

  // ---------- draft lifecycle ----------

  /**
   * Закрепить заявку за клиентом, не дожидаясь публикации.
   *
   * Нужно для WhatsApp: там номер известен с первого сообщения, и держать
   * заявку ничьей значит лишить оператора единственного способа связаться с
   * человеком, бросившим оформление. На сайте всё остаётся как было —
   * черновик анонимен, пока телефон не подтверждён.
   */
  async attachClient(orderId: string, clientProfileId: string): Promise<void> {
    await this.prisma.order.update({ where: { id: orderId }, data: { clientId: clientProfileId } });
  }

  async createDraft(
    categorySlug?: string,
    urgent = false,
    attribution?: { source?: string; sourceParams?: Record<string, string>; landingPath?: string; channel?: string },
  ) {
    let categoryId: string | undefined;
    if (categorySlug) {
      const category = await this.prisma.category.findUnique({ where: { slug: categorySlug } });
      if (category) categoryId = category.id;
    }
    // Источник фиксируем только здесь, при рождении заявки: позже человек
    // ходит по сайту, метки теряются, и «последний клик» приписал бы заказ
    // не тому каналу.
    const order = await this.prisma.order.create({
      data: {
        categoryId,
        urgent,
        status: categoryId ? "CLARIFYING" : "DRAFT",
        channel: attribution?.channel ?? "WEB",
        source: attribution?.source,
        sourceParams: (attribution?.sourceParams as object) ?? undefined,
        landingPath: attribution?.landingPath,
      },
    });
    return this.toDto(order.id);
  }

  async chat(orderId: string, message: string, lang: Language = "ru"): Promise<ChatTurnResponse> {
    const order = await this.getRawOrThrow(orderId);
    this.assertEditable(order);
    await this.prisma.chatMessage.create({ data: { orderId, role: "USER", content: message } });

    // Первая реплика клиента — момент, когда владельцу стоит о заявке узнать.
    // Считаем после записи, поэтому единица означает «эта реплика и есть
    // первая». Ждать публикации нельзя: заявки 102, 103 и 104 до неё не
    // дошли, и в вечернюю сводку попали, когда звонить было уже поздно.
    const userMessages = await this.prisma.chatMessage.count({ where: { orderId, role: "USER" } });
    if (userMessages === 1) {
      await this.newOrderAlert.alert(orderId, message);
    }

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

    return this.applyFieldUpdate(orderId, categoryRow, { ...knownFields, ...extracted }, lang, {
      previousFields: knownFields,
      categoryJustDetermined,
    });
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
    // Same reasoning as in setField: picking from the category chips is an
    // answer to the bot's question, so it belongs in the transcript.
    await this.prisma.chatMessage.create({
      data: { orderId, role: "USER", content: (category.name as unknown as LocalizedText)[lang] },
    });

    // Выбор из списка — тоже момент, когда категория стала известна, и цену
    // здесь надо назвать так же, как при автоматическом определении.
    return this.applyFieldUpdate(orderId, category, (order.fieldsData ?? {}) as Record<string, unknown>, lang, {
      categoryJustDetermined: true,
    });
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
    // Answers given through a chip or the field box are just as much the
    // client's turn as free text is — without this the transcript showed a
    // wall of questions with nothing in between, and the client couldn't see
    // (or re-read) what they had already told us.
    await this.prisma.chatMessage.create({
      data: { orderId, role: "USER", content: formatFieldValue(value, field, lang) },
    });
    return this.applyFieldUpdate(orderId, category, knownFields, lang, {
      previousFields: (order.fieldsData ?? {}) as Record<string, unknown>,
      answeredKey: key,
    });
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
    category: { id: string; slug?: string; fields: unknown },
    mergedFields: Record<string, unknown>,
    lang: Language = "ru",
    context: {
      /** What was already filled before this turn — anything new that the
       * client didn't type in answer to a question was inferred by the AI. */
      previousFields?: Record<string, unknown>;
      /** The field the client answered outright, so it isn't read back. */
      answeredKey?: string;
      /** Категорию определили именно этой репликой — значит самое время
       *  назвать порядок цены, см. priceNotice ниже. */
      categoryJustDetermined?: boolean;
    } = {},
  ): Promise<ChatTurnResponse> {
    const fields = category.fields as unknown as CategoryField[];
    // Defense in depth against AI extraction (chat/pickCategory path): an
    // LLM isn't guaranteed to return a clean number just because the prompt
    // asked for one — drop anything that doesn't match its field's declared
    // type instead of saving garbage, so the question just gets asked again.
    const typeValidatedFields = Object.fromEntries(
      Object.entries(mergedFields).filter(([key, value]) => {
        const field = fields.find((f) => f.key === key);
        return !field || isValidFieldValue(field, value);
      }),
    );
    // Клиент, ответивший вопросом, ничего не сообщил — но извлечение видит
    // непустую строку и кладёт её в поле. Так «Так что хотели» оказалось в
    // графе «адрес объекта»: заявка ушла поставщику с репликой из разговора
    // вместо адреса, и заметить это мог только человек, читающий её глазами.
    // Проверяем лишь то, что меняется на этом шаге: уже сохранённое трогать
    // нельзя, иначе правка соседнего поля вычистит старые значения.
    const previousValues = context.previousFields ?? {};
    const droppedQuestions: string[] = [];
    const answerChecked = Object.fromEntries(
      Object.entries(typeValidatedFields).filter(([key, value]) => {
        if (previousValues[key] === value) return true;
        if (typeof value === "string" && isQuestionNotAnswer(value)) {
          droppedQuestions.push(key);
          return false;
        }
        return true;
      }),
    );
    const { values: dateChecked, droppedPast } = dropPastDateTimeFields(fields, answerChecked);
    // The city arrives as whatever the client wrote and the AI echoed back.
    // Store only a canonical name so dispatch can match it — an unrecognised
    // one is dropped, which re-asks the question rather than accepting a
    // value that would match no supplier and strand the order.
    const validatedFields = { ...dateChecked };
    let unknownCity: string | undefined;
    if (typeof validatedFields.city === "string") {
      const resolved = resolveCity(validatedFields.city);
      if (resolved) {
        validatedFields.city = resolved.name.ru;
      } else {
        unknownCity = validatedFields.city;
        delete validatedFields.city;
      }
    }
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

    const pastNotice =
      droppedPast.length === 0
        ? ""
        : lang === "kk"
          ? "Бұл уақыт өтіп кетті. Күні мен уақытын қайта көрсетіңіз, мысалы «ертең 9:00».\n\n"
          : "Это время уже прошло. Укажите дату и время заново — например, «завтра в 9:00».\n\n";
    const cityNotice = !unknownCity
      ? ""
      : lang === "kk"
        ? `«${unknownCity}» қаласын танымадым. Біз жұмыс істейтін қалалар: ${citySuggestions("kk")} және басқалары.\n\n`
        : `Не узнал город «${unknownCity}». Мы работаем в городах: ${citySuggestions("ru")} и другие.\n\n`;
    // Город назван, но исполнителей там нет ни одного. Молчать об этом —
    // значит провести человека через четыре вопроса к сообщению «не нашли
    // подходящих исполнителей»; узнаёт он последним и больше не вернётся.
    //
    // Реальный случай: заявка из Костаная, где у нас ноль исполнителей при
    // 114 в Астане. Говорим сразу и не мешаем оформить — вдруг появятся, а
    // список таких городов заодно показывает, куда расширяться.
    let coverageNotice = "";
    const cityValue = validatedFields.city;
    if (!unknownCity && typeof cityValue === "string" && cityValue && previousValues.city !== cityValue) {
      const covered = await this.prisma.serviceArea.count({ where: { city: cityValue } });
      if (covered === 0) {
        coverageNotice =
          lang === "kk"
            ? `${cityValue} қаласында бізде әзірге орындаушылар жоқ. Өтінімді рәсімдей аламын және олар пайда болғанда хабарлаймын.\n\n`
            : `В городе ${cityValue} у нас пока нет исполнителей. Заявку оформлю и напишу вам, как только они появятся.\n\n`;
      }
    }

    // Отброшенный вопрос нельзя проглотить молча: тот же вопрос, заданный
    // заново без единого слова объяснения, выглядит так, будто бот не читает
    // собеседника — а человек и так уже написал, что не понимает происходящего.
    const questionNotice =
      droppedQuestions.length === 0
        ? ""
        : lang === "kk"
          ? `Бұл жауап емес, сұрақ сияқты — мен оны түсінбедім. Қайта сұраймын, ал тірі адам керек болса: ${env.supportPhone}\n\n`
          : `Кажется, это вопрос, а не ответ — я его не понял. Спрошу ещё раз, а если нужен живой человек: ${env.supportPhone}\n\n`;
    // Anything the AI pulled out of free text was never asked about, so the
    // client has no idea it was decided — order №51 ended up with a date
    // taken from "на завтра" that appears nowhere in the conversation, and a
    // wrong guess would have been just as invisible. Read those values back.
    const previousFields = previousValues;
    // Changed counts, not just newly filled. A client correcting a date the
    // AI had already guessed got no acknowledgement at all — the value moved
    // silently, so the conversation looked frozen while it was in fact
    // working.
    const inferred = fields.filter(
      (f) =>
        f.key !== context.answeredKey &&
        f.type !== "photo" &&
        validatedFields[f.key] !== undefined &&
        previousFields[f.key] !== validatedFields[f.key],
    );
    const inferredNotice =
      inferred.length === 0
        ? ""
        : `${lang === "kk" ? "Хабарламаңыздан түсінгенім" : "Из вашего сообщения понял"}: ` +
          inferred.map((f) => `${f.label[lang].toLowerCase()} — ${formatFieldValue(validatedFields[f.key], f, lang)}`).join(", ") +
          `.\n\n`;

    // Порядок цены — в первой же реплике, а не в ответ на вопрос о ней.
    //
    // Двое из пяти клиентов спросили цену первым или вторым сообщением и оба
    // ушли. Отвечать «цену назовёт исполнитель» на прямой вопрос честно, но
    // поздно: человек уже решил, что от него отмахнулись. Говорим сами, как
    // только знаем категорию, — до того, как он спросил.
    //
    // Ровно один раз за заявку: категория определяется на первом сообщении и
    // дальше не меняется, а повторять вилку у каждого вопроса — навязчиво.
    const priceNotice = context.categoryJustDetermined ? withGap(priceHintSentence(category.slug, lang)) : "";

    const assistantMessage =
      missing.length === 0
        ? inferredNotice + coverageNotice + priceNotice + readyForReviewMessage(lang)
        : inferredNotice + coverageNotice + priceNotice + questionNotice + pastNotice + cityNotice + buildQuestionText(missing, lang);
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
  /**
   * Same confirmation, reached without an OTP first. Typing a code proved the
   * phone, then tapping the WhatsApp button proved it again — two challenges
   * for one fact, and the code step was the one that dropped people. The tap
   * is the stronger of the two anyway: it arrives by webhook from the number
   * itself, where a code can be read off someone else's screen.
   *
   * The order stays unpublished until that tap, so the worst an unverified
   * caller achieves is sending one message to a number they typed — which is
   * why the rate limit below exists.
   */
  async requestPublishConfirmationByPhone(orderId: string, rawPhone: string) {
    const phone = normalizePhone(rawPhone);
    if (!isValidPhone(phone)) throw new BadRequestException("Некорректный номер телефона");

    // Without a code standing in the way, this endpoint is a way to make us
    // send a WhatsApp message to any number someone types. Capped per number
    // per day so it can't be turned into a way to pester one.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sentToday = await this.prisma.notificationLog.count({
      where: { recipientPhone: phone, templateKey: "order_confirm_request", createdAt: { gt: dayAgo } },
    });
    if (sentToday >= 5) {
      throw new BadRequestException("Слишком много запросов подтверждения на этот номер. Попробуйте завтра.");
    }

    const authUser = await this.authOtp.getOrCreateClientAuthUser(phone);
    return this.requestPublishConfirmation(orderId, authUser);
  }

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
    // Отсчёт от ДАТЫ РАБОТЫ, а не от публикации.
    //
    // Заявка №76: опубликована 7 августа, работа назначена на 10-е, 15:00.
    // Через 48 часов после публикации, то есть 9-го, система закрыла её как
    // «клиент не ответил на проверку статуса» и написала исполнителю
    // «звонить по ней не нужно» — за день до выезда, при том что он уже
    // договорился с клиентом о цене.
    //
    // Спрашивать «услугу оказали?» раньше, чем она должна была состояться,
    // бессмысленно, а закрывать по молчанию на такой вопрос — вредно.
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { dateNeeded: true },
    });
    const now = Date.now();
    // Дата в прошлом (заявка «на сегодня, сейчас») или её нет — считаем от
    // публикации, как раньше.
    const from = Math.max(order?.dateNeeded?.getTime() ?? now, now);

    // Сводка «сколько человек открыли заявку» — отсчёт от публикации, а не от
    // даты работы: она про то, что происходит прямо сейчас, и через сутки
    // бессмысленна.
    if (env.dispatchProgressAfterMinutes > 0) {
      await this.matchingQueue.add(
        "dispatch-progress",
        { orderId },
        { delay: env.dispatchProgressAfterMinutes * 60 * 1000 },
      );
    }

    const checkinAt = from + env.orderCheckinDelayHours * 3600 * 1000;
    await this.matchingQueue.add("checkin", { orderId }, { delay: checkinAt - now });
    await this.matchingQueue.add(
      "checkin-escalate",
      { orderId },
      { delay: checkinAt - now + env.orderCheckinAutoCloseHours * 3600 * 1000 },
    );
  }

  /**
   * Resolves an order from its publicToken into the identity of the client
   * who owns it. Dropping the OTP step left the web client with no JWT, so
   * the buttons on their own order page — "услуга оказана", "отменить" —
   * silently did nothing: the handler returned early on a missing token with
   * no error to show. Possession of the unguessable token is the proof here,
   * the same model the confirm-by-link and supplier-card routes already use.
   */
  private async ownerFromPublicToken(token: string): Promise<{ orderId: string; user: AuthUser }> {
    const order = await this.prisma.order.findUnique({
      where: { publicToken: token },
      include: { client: { include: { user: true } } },
    });
    if (!order) throw new NotFoundException("Заявка не найдена");
    if (!order.clientId || !order.client) {
      throw new BadRequestException("Заявка ещё не подтверждена");
    }
    return {
      orderId: order.id,
      user: {
        sub: order.client.userId,
        phone: order.client.user.phone,
        role: "client",
        profileId: order.clientId,
      },
    };
  }

  async completeOrderByToken(token: string, outcome: OrderCompletionOutcome, comment?: string) {
    const { orderId, user } = await this.ownerFromPublicToken(token);
    return this.completeOrder(orderId, user, outcome, comment);
  }

  async cancelByToken(token: string, dto: CancelOrderDto) {
    const { orderId, user } = await this.ownerFromPublicToken(token);
    return this.cancel(orderId, user, dto);
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
   * is the one action that ends it. No operator is ever involved: the
   * platform only connects client and supplier, it doesn't mediate whether
   * the service actually happened.
   * - "resolved": supplier delivered, order is COMPLETED.
   * - "redispatch": this supplier didn't work out, order stays PUBLISHED
   *   and a fresh matching wave goes out (excludes already-notified
   *   suppliers, see MatchingService.sendWave).
   * - "closed": client is done trying, order is CANCELLED_BY_CLIENT. */
  async completeOrder(orderId: string, user: AuthUser, outcome: OrderCompletionOutcome, comment?: string) {
    const order = await this.getRawOrThrow(orderId);
    this.assertOwnership(order, user);
    if (order.status !== "PUBLISHED") {
      throw new BadRequestException("Завершить можно только активную заявку");
    }

    // Исполнитель найден — неважно, наш или сторонний: для клиента задача
    // решена, и заявка выполнена, а не отменена.
    if (
      outcome === "found_via_us" ||
      outcome === "found_elsewhere" ||
      outcome === "found_unknown" ||
      outcome === "resolved"
    ) {
      const viaUs = outcome === "found_elsewhere" ? false : outcome === "found_unknown" ? null : true;
      await this.prisma.order.update({
        where: { id: orderId },
        // Оценку ставим только когда человек прямо сказал, что нашёл через
        // нас. Прежний код при закрытии проставлял отрицательную оценку —
        // то есть жаловался на сервис от имени довольного клиента.
        data: { clientRatingPositive: viaUs === true ? true : null, clientRatingComment: comment },
      });
      await this.transitionStatus(orderId, "COMPLETED", "client");
      await this.prisma.order.update({ where: { id: orderId }, data: { completedAt: new Date() } });
      await this.analytics.track("order_completed", { orderId, userId: user.sub, metadata: { viaUs } });
      await this.notifySuppliersOrderClosed(orderId, order.number, "found");
    } else if (outcome === "not_needed" || outcome === "closed") {
      await this.closeOrderAsCancelled(orderId, order.number, "client", comment || "Клиенту больше не нужно", {
        notifySuppliers: false,
      });
      await this.notifySuppliersOrderClosed(orderId, order.number, "cancelled");
      await this.analytics.track("order_cancelled", { orderId, userId: user.sub, metadata: { reason: "not_needed" } });
    } else {
      await this.matchingQueue.add("start", { orderId });
      await this.analytics.track("order_redispatch_requested", { orderId, userId: user.sub });
    }

    const dto = await this.toDto(orderId);
    this.realtime.emitOrderUpdated(orderId, dto);
    return dto;
  }

  /** Proactive nudge — fired ORDER_CHECKIN_DELAY_HOURS after publish. No-op if
   * the client already closed the order (or it's stuck in NEEDS_OPERATOR)
   * by the time the delayed job runs. */
  /**
   * Одно напоминание о недооформленной заявке.
   *
   * Заявка №80 — самосвал, песок, 20 м³, адрес назван — встала на вопросе о
   * дате и умерла. До рассылки оставался один ответ. Таких на сегодня 27, и
   * каждая это клиент, который хотел заказать и не смог.
   *
   * Три решения определяют, помощь это или спам.
   *
   * Повторяем сам вопрос, а не пишем «вы не закончили». Второе требует от
   * человека вспомнить, на чём он остановился, и вернуться в разговор;
   * первое — только ответить.
   *
   * Напоминание ровно одно. Второе это уже назойливость, а в WhatsApp за неё
   * платят рейтингом номера: человек не отпишется, он пожалуется.
   *
   * И только в приличное время. Напоминание в три часа ночи не вернёт
   * заказчика, оно вернёт жалобу.
   */
  @Cron("*/15 * * * *")
  async nudgeAbandonedDrafts(): Promise<void> {
    if (env.draftNudgeAfterMinutes <= 0) return;
    if (!isDecentHourNow()) return;

    const idleSince = new Date(Date.now() - env.draftNudgeAfterMinutes * 60 * 1000);
    // Окно 24 часов: свободный текст вне его не проходит, а шаблона под
    // напоминание нет и заводить его ради этого не стоит.
    const windowOpenSince = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const abandoned = await this.prisma.order.findMany({
      where: {
        channel: "WHATSAPP",
        status: { in: ["DRAFT", "CLARIFYING"] },
        draftNudgeAt: null,
        updatedAt: { lt: idleSince },
        clientId: { not: null },
        client: { user: { lastInboundWhatsAppAt: { gt: windowOpenSince } } },
      },
      include: { category: true, client: { include: { user: true } } },
      take: 50,
    });

    for (const order of abandoned) {
      try {
        await this.sendDraftNudge(order);
      } catch (err) {
        this.logger.error(`Не удалось напомнить о заявке ${order.number}: ${(err as Error).message}`);
      }
    }
    if (abandoned.length > 0) this.logger.log(`Напомнили о недооформленных заявках: ${abandoned.length}`);
  }

  private async sendDraftNudge(order: {
    id: string;
    number: number;
    fieldsData: unknown;
    category: { fields: unknown } | null;
    client: { user: { phone: string; preferredLanguage: string } } | null;
  }): Promise<void> {
    if (!order.client) return;
    const lang = toLang(order.client.user.preferredLanguage);
    const fields = (order.category?.fields as unknown as CategoryField[]) ?? [];
    const values = (order.fieldsData ?? {}) as Record<string, unknown>;
    const missing = nextQuestionFields(fields, values);
    // Нечего спрашивать — значит заявка стоит не на вопросе, а на публикации;
    // это другой случай и другое сообщение, здесь молчим.
    if (missing.length === 0) return;

    // Короткая сводка того, что уже сказано: она и напоминает, о чём речь, и
    // показывает, что сказанное не потерялось.
    const filled = fields
      .filter((f) => f.type !== "photo" && values[f.key] !== undefined)
      .map((f) => formatFieldValue(values[f.key], f, lang))
      .join(", ");

    const head =
      lang === "kk"
        ? `Өтінім аяқталмай қалды${filled ? `: ${filled}` : ""}.`
        : `Вы остановились на заявке${filled ? `: ${filled}` : ""}.`;
    const tail = lang === "kk" ? "Аяқтау үшін бір қадам қалды." : "Остался один шаг.";

    await this.notifications.send({
      event: "draft_nudge",
      payload: { head, tail, question: buildQuestionText(missing, lang) },
      recipientPhone: order.client.user.phone,
      orderId: order.id,
    });
    await this.prisma.order.update({
      where: { id: order.id },
      data: { draftNudgeAt: new Date() },
    });
  }

  /**
   * Заявки, застрявшие на подтверждении: напомнить один раз, потом закрыть.
   *
   * Клиент заполнил всё на сайте, получил в WhatsApp карточку с кнопкой
   * «Подтвердить» — и не нажал. Проверки на этот статус не было никакой: ни
   * напоминания, ни закрытия, поэтому такая заявка живёт вечно. Самая старая
   * висит с 19 июля и будет висеть, пока её не заметят руками.
   *
   * Напомнить можно только тем же утверждённым шаблоном: клиент нам не писал,
   * значит 24-часовое окно закрыто и свободный текст не пройдёт. Повторная
   * отправка одобренного шаблона разрешена и ничего не ждёт.
   */
  /**
   * Закрывает черновики, которые не двигались больше суток.
   *
   * Заявка в «уточнении данных» — это незаконченный разговор. Если человек не
   * вернулся за сутки, он не вернётся: за месяцы работы ни один такой черновик
   * не превратился в заказ. Зато они копятся — на 13 августа тридцать штук,
   * самая старая с 19 июля, — и оператор тратит время, открывая пустые.
   *
   * Считаем по updatedAt, а не по createdAt — в отличие от соседнего крона
   * ниже. Там опасались, что правка оператора сделает заявку бессмертной; тут
   * наоборот: черновик двигают только сообщения самого клиента, и это ровно
   * тот признак, по которому его нельзя трогать. Разговор в WhatsApp может
   * идти с перерывом в день, и закрывать его по дате создания — значит
   * оборвать человека на полуслове.
   *
   * Поставщиков не уведомляем: заявка не публиковалась, они о ней не знают.
   * Клиенту тоже не пишем — он ушёл сам, и «мы закрыли вашу заявку» будет
   * выглядеть придиркой к тому, кто ничего не просил.
   */
  @Cron("20 * * * *")
  async expireStaleDrafts(): Promise<void> {
    if (env.orderDraftExpireHours <= 0) return;

    const idleBefore = new Date(Date.now() - env.orderDraftExpireHours * 60 * 60 * 1000);
    const stale = await this.prisma.order.findMany({
      where: { status: { in: ["DRAFT", "CLARIFYING"] }, updatedAt: { lt: idleBefore } },
      select: { id: true, number: true },
      take: 200,
    });

    for (const order of stale) {
      try {
        await this.closeOrderAsCancelled(
          order.id,
          order.number,
          "system",
          `Заявка не завершена — данные не уточнены больше ${env.orderDraftExpireHours} ч`,
          { notifySuppliers: false },
        );
      } catch (err) {
        this.logger.error(`Не удалось закрыть черновик ${order.number}: ${(err as Error).message}`);
      }
    }

    if (stale.length) this.logger.log(`Закрыто незавершённых заявок: ${stale.length}`);
  }

  @Cron("0 * * * *")
  async chaseUnconfirmedOrders(): Promise<void> {
    const now = Date.now();
    const nudgeBefore = new Date(now - env.orderConfirmNudgeAfterHours * 60 * 60 * 1000);
    const expireBefore = new Date(now - env.orderConfirmExpireDays * 24 * 60 * 60 * 1000);

    // Сначала закрываем просроченные — иначе заявке, которой третий день,
    // сперва ушло бы напоминание, а следом извинение за закрытие.
    const expired = await this.prisma.order.findMany({
      // По дате создания, а не updatedAt: тот сдвигается от любой правки —
      // достаточно оператору поправить поле, и заявка становится бессмертной.
      where: { status: "AWAITING_PHONE_CONFIRMATION", createdAt: { lt: expireBefore } },
      select: { id: true, number: true },
    });
    for (const order of expired) {
      try {
        await this.closeOrderAsCancelled(
          order.id,
          order.number,
          "system",
          "Заявка не подтверждена — закрыта автоматически",
        );
      } catch (err) {
        this.logger.error(`Не удалось закрыть неподтверждённую ${order.number}: ${(err as Error).message}`);
      }
    }

    if (!isDecentHourNow()) return;

    const pending = await this.prisma.order.findMany({
      where: {
        status: "AWAITING_PHONE_CONFIRMATION",
        confirmNudgeAt: null,
        // Просроченные уже закрыты выше и сюда не попадут — статус изменился.
        updatedAt: { lt: nudgeBefore },
      },
      include: { category: true, client: { include: { user: true } } },
      take: 50,
    });
    for (const order of pending) {
      try {
        await this.resendConfirmRequest(order);
      } catch (err) {
        this.logger.error(`Не удалось напомнить о подтверждении ${order.number}: ${(err as Error).message}`);
      }
    }

    if (expired.length || pending.length) {
      this.logger.log(`Неподтверждённые заявки: напомнили ${pending.length}, закрыли ${expired.length}`);
    }
  }

  /** Тот же шаблон и та же кнопка, что и в первый раз: другого способа
   *  достучаться до клиента, который нам не писал, не существует. */
  private async resendConfirmRequest(order: {
    id: string;
    number: number;
    publicToken: string;
    city: string | null;
    fieldsData: unknown;
    dateNeeded: Date | null;
    timeWindow: string | null;
    category: { name: unknown; fields: unknown } | null;
    client: { user: { phone: string; preferredLanguage: string } } | null;
  }): Promise<void> {
    if (!order.client || !order.category) return;
    const lang = toLang(order.client.user.preferredLanguage);
    const fields = order.category.fields as unknown as CategoryField[];

    await this.notifications.send({
      event: "order_confirm_request",
      payload: {
        orderNumber: order.number,
        categoryName: (order.category.name as unknown as LocalizedText)[lang],
        city: order.city ?? "",
        whenText: formatWhen(order as never, lang),
        fullDescription: fullDescription(order.fieldsData, fields, lang),
        confirmUrl: `${env.webUrl}/confirm/${order.publicToken}`,
      },
      recipientPhone: order.client.user.phone,
      orderId: order.id,
      buttons: [{ id: `confirm_publish|${order.id}`, text: lang === "kk" ? "Растау" : "Подтвердить" }],
    });
    await this.prisma.order.update({
      where: { id: order.id },
      data: { confirmNudgeAt: new Date() },
    });
  }

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
        { id: `complete|resolved|${orderId}`, text: lang === "kk" ? "Қызмет көрсетілді" : "Услуга оказана" },
        { id: `complete|redispatch|${orderId}`, text: lang === "kk" ? "Басқасын ұсыну" : "Отправить повторно" },
        { id: `complete|closed|${orderId}`, text: lang === "kk" ? "Өтінімді жабу" : "Закрыть заявку" },
      ],
    });
  }

  /** Fired ORDER_CHECKIN_AUTO_CLOSE_HOURS after the check-in message — the
   * platform is a pure connector with no delivery guarantee, so a client who
   * never answers isn't handed to a human operator: the order is simply
   * closed, same as if the client had picked "Закрыть заявку" themselves. */
  async autoCloseStaleOrder(orderId: string) {
    const order = await this.getRawOrThrow(orderId);
    if (order.status !== "PUBLISHED") return;

    // Исполнителям НЕ сообщаем. Утверждённый шаблон говорит «Клиент закрыл
    // заявку — звонить по ней не нужно», а здесь клиент ничего не закрывал:
    // он всего лишь не нажал кнопку в проверке статуса. Для человека, уже
    // договорившегося о работе, это указание отменить живой заказ — именно
    // так мы едва не сорвали заявку №76.
    //
    // Мы соединяем людей и не гарантируем сделку: молчание клиента означает
    // лишь то, что заявку пора убрать из активных у нас, а не то, что
    // работы не будет.
    await this.closeOrderAsCancelled(
      orderId,
      order.number,
      "system",
      "Клиент не ответил на проверку статуса — заявка закрыта автоматически",
      { notifySuppliers: false, status: "CLOSED_NO_RESPONSE" },
    );
    this.realtime.emitOrderUpdated(orderId, await this.toDto(orderId));
  }

  /**
   * Сообщить исполнителям, чем кончилась заявка.
   *
   * Два разных события, а не одно. «Клиент нашёл исполнителя» — нормальный
   * рабочий финал, извиняться тут не за что. «Клиенту больше не нужно» —
   * человека дёрнули зря, и извинение уместно.
   *
   * До сих пор во всех случаях уходило «Заявка отменена. Извините за
   * беспокойство» — включая того исполнителя, который эту заявку и взял.
   *
   * ОГРАНИЧЕНИЕ. Правильный текст про найденного исполнителя уходит только
   * свободным сообщением, а оно доходит лишь внутри 24-часового окна. У Меты
   * утверждён единственный подходящий шаблон — про ОТМЕНУ, и его текст
   * заморожен. Поэтому тем, у кого окно закрыто, мы в этом случае не пишем
   * ничего: молчание нейтрально, а ложное «отменена» дезинформирует и бьёт
   * по тому, кто сейчас едет к клиенту. Чтобы дошло до всех, нужен новый
   * шаблон, утверждённый у Меты.
   */
  /**
   * Сообщить исполнителям, чем кончилась заявка.
   *
   * Два разных события, а не одно. «Клиент нашёл исполнителя» — нормальный
   * рабочий финал, извиняться тут не за что. «Клиенту больше не нужно» —
   * человека дёрнули зря, и извинение уместно.
   *
   * До появления второго события во всех случаях уходило «Заявка отменена.
   * Извините за беспокойство» — включая того исполнителя, который эту заявку
   * и взял.
   *
   * Оба идут утверждённым шаблоном: сообщение приходит через часы после
   * рассылки, когда 24-часовое окно давно закрыто, и свободный текст до
   * человека просто не дойдёт.
   */
  private async notifySuppliersOrderClosed(
    orderId: string,
    orderNumber: number,
    kind: "found" | "cancelled",
  ): Promise<void> {
    await this.notifyDispatchedSuppliers(
      orderId,
      orderNumber,
      kind === "found" ? "order_closed_found" : "order_cancelled",
    );
  }

  private async closeOrderAsCancelled(
    orderId: string,
    orderNumber: number,
    actor: string,
    reason: string,
    opts: { notifySuppliers: boolean; status?: OrderStatus } = { notifySuppliers: true },
  ): Promise<void> {
    await this.transitionStatus(orderId, opts.status ?? "CANCELLED_BY_CLIENT", actor, reason);
    await this.prisma.order.update({ where: { id: orderId }, data: { cancelledAt: new Date(), cancelReason: reason } });
    if (opts.notifySuppliers) await this.notifyDispatchedSuppliers(orderId, orderNumber, "order_cancelled");
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
  /**
   * Сообщить об отмене — только тем, кто саму заявку получил.
   *
   * Раньше список брался из dispatchWave.supplierIds, то есть из кандидатов, а
   * не из адресатов. В волну попадают трое разных: получившие полную заявку,
   * получившие только холодное приглашение без деталей и отсечённые квотой
   * или тихими часами — последним не уходило вообще ничего.
   *
   * Заявка №101: полную заявку получили семеро, приглашение — четверо, а
   * «заявка отменена» ушло тридцати. Девятнадцать человек узнали об отмене
   * заказа, о существовании которого не знали.
   *
   * Для холодного контакта это вдвойне плохо: второе в жизни сообщение от нас
   * — «звонить по ней не нужно» про заказ, которого он не видел. Так и
   * зарабатывают жалобы на спам, а вместе с ними — понижение качества номера
   * у Меты.
   *
   * Источник правды — журнал отправок: кому фактически ушёл order_broadcast_full
   * по этой заявке. Он же покрывает случай, когда холодный контакт согласился
   * позже: в этот момент ему уходит та же полная заявка.
   */
  async notifyDispatchedSuppliers(
    orderId: string,
    orderNumber: number,
    event: "order_cancelled" | "order_closed_found",
  ) {
    const sent = await this.prisma.notificationLog.findMany({
      where: { orderId, templateKey: "order_broadcast_full", supplierId: { not: null } },
      select: { supplierId: true },
    });
    const supplierIds = new Set<string>(sent.map((s) => s.supplierId!));
    if (supplierIds.size === 0) return;

    const suppliers = await this.prisma.supplierProfile.findMany({
      where: { id: { in: Array.from(supplierIds) } },
      include: { user: true },
    });

    // Категория и город нужны утверждённому шаблону order_cancelled: одного
    // номера мало, чтобы человек понял, о какой из полученных заявок речь.
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { category: true },
    });

    for (const supplier of suppliers) {
      const lang = toLang(supplier.user.preferredLanguage);
      await this.notifications.send({
        event,
        payload: {
          orderNumber,
          categoryName: order?.category ? (order.category.name as unknown as LocalizedText)[lang] : "",
          city: order?.city ?? "",
        },
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

  /**
   * @param viewer — отпечаток открывшего: по нему считаются РАЗНЫЕ исполнители,
   *   а не число обновлений страницы. Ссылка одна на всех, личности за ней нет,
   *   поэтому отпечаток — единственный доступный способ отличить троих
   *   заинтересовавшихся от одного, открывшего заявку трижды.
   */
  async getByPublicToken(token: string, viewer?: string) {
    const order = await this.prisma.order.findUnique({ where: { publicToken: token } });
    if (!order) throw new NotFoundException("Заявка не найдена");
    if (viewer) {
      // Клиенту важно знать, что заявку смотрят: тишина после отправки
      // читается как «ничего не работает». Заявку №100 клиент закрыл через
      // восемь минут, а исполнители открыли её на одиннадцатой и девятнадцатой.
      await this.analytics
        .track("supplier_opened_order", { orderId: order.id, metadata: { viewer } })
        .catch(() => undefined); // счётчик не должен мешать открыть заявку
    }
    return this.toDto(order.id);
  }

  /** Сколько разных исполнителей открывали заявку. */
  async countOrderViewers(orderId: string): Promise<number> {
    const rows = await this.prisma.analyticsEvent.findMany({
      where: { orderId, eventType: "supplier_opened_order" },
      select: { metadata: true },
    });
    const seen = new Set<string>();
    for (const r of rows) {
      const viewer = (r.metadata as { viewer?: string } | null)?.viewer;
      if (viewer) seen.add(viewer);
    }
    return seen.size;
  }

  /**
   * Через несколько минут после рассылки — сказать клиенту, что происходит.
   *
   * Это единственное сообщение между «отправили N исполнителям» и первым
   * звонком. Без него человек сидит в тишине и решает, что сервис не работает:
   * ровно так закрылась заявка №100.
   *
   * Отдельная ветка на ноль просмотров нужна не меньше: молчать в этом случае
   * значит дать человеку прождать впустую весь вечер. Владельцу об этом тоже
   * сообщаем — ноль открытий при тридцати разосланных означает, что проблема
   * не у клиента, а у нас.
   */
  async sendDispatchProgress(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { client: { include: { user: true } } },
    });
    if (!order || order.status !== "PUBLISHED") return; // уже закрыта или отменена
    const phone = order.client?.user.phone;
    if (!phone) return;

    // Считаем ПРОЧИТАВШИХ, а не перешедших по ссылке.
    //
    // Сначала здесь стояли переходы на /s/<token>, и это оказалось пустым
    // сигналом: в полной заявке телефон клиента написан прямо в сообщении,
    // открывать сайт исполнителю незачем — он просто звонит. По заявке №113
    // переходов было ноль, и владельцу ушло «не открыл ни один исполнитель»,
    // хотя сообщение прочитали восемь из одиннадцати.
    //
    // Отметки о прочтении приходят вебхуком от Меты и лежат в readAt — это
    // тот же признак, который виден в стенограмме, и расходиться с ним
    // сводка не должна.
    const { read, sent } = await this.countOrderReads(orderId, order.number);
    const lang = await this.getLangForPhone(phone);

    const text =
      read > 0
        ? lang === "kk"
          ? `Өтінімді ${read} орындаушы оқыды — қоңырауларды күтіңіз.\n\n` +
            "Бір сағат ішінде ешкім қоңырау шалмаса — бізге жазыңыз, қайта жібереміз."
          : `Вашу заявку прочитали ${read} ${plural(read, "исполнитель", "исполнителя", "исполнителей")} из ${sent} — ждите звонков.\n\n` +
            "Если в ближайший час никто не позвонит — напишите нам, разошлём повторно."
        : lang === "kk"
          ? "Өтінімді әзірге ешкім оқыған жоқ. Біз оны көреміз және қайта жіберуге тырысамыз — сізден ештеңе қажет емес."
          : "Заявку пока никто не прочитал. Мы это видим и разошлём её ещё раз — от вас ничего не нужно.";

    try {
      await this.whatsapp.sendText(phone, text);
    } catch (err) {
      this.logger.warn(`Не удалось отправить сводку по рассылке: ${(err as Error).message}`);
    }

    if (read === 0) {
      await this.newOrderAlert.alertNoViews(orderId, order.number, sent);
    }
  }

  /**
   * Сколько исполнителей прочитали заявку и скольким она ушла.
   *
   * Дайджест приходится искать по номеру заявки внутри самого сообщения:
   * одно сообщение на несколько заказов, поэтому orderId у него пустой —
   * та же причина, по которой карточка заявки показывала треть отправок.
   */
  private async countOrderReads(orderId: string, orderNumber: number): Promise<{ read: number; sent: number }> {
    const where = {
      OR: [
        { orderId, templateKey: "order_broadcast_full" },
        {
          templateKey: "order_digest",
          payload: { path: ["orders"], array_contains: [{ orderNumber }] },
        },
      ],
    };
    const [sent, read] = await Promise.all([
      this.prisma.notificationLog.count({ where }),
      this.prisma.notificationLog.count({ where: { ...where, readAt: { not: null } } }),
    ]);
    return { read, sent };
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
