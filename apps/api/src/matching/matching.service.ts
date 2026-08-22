import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { WHATSAPP_PROVIDER, WhatsAppProvider } from "../whatsapp/whatsapp-provider.interface";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { OrdersService } from "../orders/orders.service";
import { NotificationsService } from "../notifications/notifications.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { BillingService } from "../billing/billing.service";
import { env } from "../config/env";
import { formatWhen, fullDescription, safeSummary } from "./matching-message.util";
import { isSupplierReachableNow } from "./quiet-hours.util";
import { toLang } from "../common/language.util";
import { CategoryField, Language, LocalizedText, citiesServing } from "@ai-zayavki/shared";

/**
 * Код Меты «Message undeliverable»: у номера нет WhatsApp или он не может
 * принимать сообщения. Ошибка окончательная, повторять по ней нечего.
 */
const UNDELIVERABLE_ERROR_CODE = "131026";

/**
 * Чем закончилось согласие поставщика на холодное приглашение.
 *
 * Нужен именно исход, а не void: «заявку уже закрыли» и «заявка отправлена» —
 * это два совершенно разных сообщения для человека, и молчать во втором
 * случае значит оставить его гадать, сработала кнопка или нет.
 */
export interface ColdConfirmResult {
  outcome: "order_sent" | "order_closed" | "quota_exceeded" | "unknown_supplier" | "no_order";
  /** Уже соглашался раньше — значит это повторное нажатие той же кнопки. */
  alreadyConfirmed: boolean;
}

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
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
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
        // Клиенту тоже надо сказать. Раньше он получал «мы начали поиск
        // исполнителей» и не получал больше ничего: поиск закончился ничем в
        // ту же секунду, а человек ждал звонков, которых не будет.
        await this.tellClient(
          order,
          `Заявка №${order.number} принята, но подходящих исполнителей у нас пока нет. ` +
            "Мы разберёмся вручную и напишем вам. Извините за задержку.",
          `№${order.number} өтінімі қабылданды, бірақ сәйкес орындаушылар әзірге жоқ. ` +
            "Қолмен қарап, сізге хабарласамыз. Кешігу үшін кешіріңіз.",
        );
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

    // Сколько именно и чего ждать — точным числом, сразу после рассылки.
    //
    // «Мы начали поиск исполнителей» отправляется в момент публикации, когда
    // рассылки ещё не было: она идёт очередью. Дальше человек сидит в тишине
    // и не знает ни сколько людей увидели заявку, ни когда ждать звонка.
    // Заявка №100 умерла ровно здесь — клиент закрыл её через восемь минут,
    // а первый исполнитель откликнулся на одиннадцатой.
    // Клиенту называем тех, кому заявка ФАКТИЧЕСКИ ушла, а не размер волны.
    // 22 августа подряд пришло «Отправили 22 исполнителям» и через десять
    // минут «прочитали 5 из 13»: первое число — кандидаты, включая холодные
    // контакты и отсечённых квотой, второе — настоящие адресаты. Клиент
    // видел два разных числа по одной заявке.
    const reached = await this.prisma.notificationLog.count({
      where: { orderId, templateKey: "order_broadcast_full" },
    });
    const shown = reached || candidates.length;
    const city = order.city ? ` в городе ${order.city}` : "";
    await this.tellClient(
      order,
      waveNumber === 1
        ? `Отправили заявку №${order.number} ${shown} исполнителям${city}.\n\n` +
            "Они позвонят вам сами — обычно первые звонки приходят в течение 15–30 минут.\n" +
            "Если за час никто не позвонит — напишите нам, и мы разошлём заявку повторно."
        : `Разослали заявку №${order.number} ещё ${candidates.length} исполнителям${city}. Ждите звонков.`,
      waveNumber === 1
        ? `№${order.number} өтінімін ${shown} орындаушыға жібердік${order.city ? ` (${order.city})` : ""}.\n\n` +
            "Олар сізге өздері қоңырау шалады — әдетте алғашқы қоңыраулар 15–30 минут ішінде.\n" +
            "Бір сағат ішінде ешкім қоңырау шалмаса — бізге жазыңыз, өтінімді қайта жібереміз."
        : `№${order.number} өтінімін тағы ${candidates.length} орындаушыға жібердік. Қоңырауларды күтіңіз.`,
    );

    this.realtime.emitOrderUpdated(orderId, await this.orders.toDto(orderId));
  }

  /**
   * Короткое сообщение клиенту на его языке, мимо шаблонов уведомлений.
   *
   * Через шаблоны идут события со своей структурой и историей; здесь нужен
   * один живой текст, который меняется вместе с числом исполнителей. Ошибка
   * отправки не должна ронять рассылку: исполнители уже получили заявку, и
   * это главное.
   */
  private async tellClient(
    order: { client?: { user: { phone: string; preferredLanguage?: string | null } } | null },
    ru: string,
    kk: string,
  ): Promise<void> {
    const phone = order.client?.user.phone;
    if (!phone) return;
    try {
      await this.whatsapp.sendText(phone, order.client?.user.preferredLanguage === "KK" ? kk : ru);
    } catch (err) {
      this.logger.warn(`Не удалось написать клиенту по заявке: ${(err as Error).message}`);
    }
  }

  /** One supplier, one order — quiet-hours deferral, quota gate, then the
   * full order_broadcast_full send. Shared by sendWave()'s loop above and
   * notifyConvertedProspect() below, so a freshly-registered PROSPECT gets
   * exactly the same treatment (quota consumed, quiet hours respected) as
   * anyone reached through the normal wave. */
  private async dispatchToSupplier(
    order: Awaited<ReturnType<MatchingService["loadOrderForDispatch"]>>,
    supplier: {
      id: string;
      confirmedAt: Date | null;
      user: { phone: string; preferredLanguage: string };
      workingHoursStart: string | null;
      workingHoursEnd: string | null;
    },
    settings: { quietHoursStart: string | null; quietHoursEnd: string | null },
  ): Promise<void> {
    // Non-urgent orders respect the supplier's quiet hours — held here
    // instead of sent immediately, then batched into one digest message
    // per supplier by flushPendingDigests() once their window opens.
    // Urgent orders always go through immediately: acceptsUrgent (already
    // enforced by the caller) is the supplier's own agreement to be
    // reachable any time for those.
    if (!order.urgent && !isSupplierReachableNow(supplier, settings)) {
      // A supplier who never opted in is simply skipped rather than queued:
      // the digest carries full order details (client phone included), which
      // must not reach someone who hasn't agreed to anything, and waking a
      // stranger with an unsolicited invitation at night is exactly how a
      // number earns blocks. They stay eligible for later orders.
      if (!supplier.confirmedAt) return;
      await this.prisma.pendingSupplierNotification.upsert({
        where: { supplierId_orderId: { supplierId: supplier.id, orderId: order.id } },
        create: { supplierId: supplier.id, orderId: order.id },
        update: {},
      });
      return;
    }

    const lang = toLang(supplier.user.preferredLanguage);

    // Never opted in — operator pre-loaded them from a public directory.
    // They get a privacy-safe teaser (no client phone, no address) and an
    // opt-in button instead of the real dispatch, and it costs them none of
    // their free quota: this is our invitation, not a lead they asked for.
    if (!supplier.confirmedAt) {
      if (!(await this.mayInviteAgain(supplier.id))) return;
      const categoryFields = (order.category?.fields as unknown as CategoryField[]) ?? [];
      await this.notifications.send({
        event: "supplier_cold_invite",
        payload: {
          categoryName: order.category ? (order.category.name as unknown as LocalizedText)[lang] : "",
          city: order.city ?? "",
          safeSummary: safeSummary(order.fieldsData, categoryFields, lang),
          freeQuota: env.freeNotificationsPerMonth,
        },
        recipientPhone: supplier.user.phone,
        supplierId: supplier.id,
        orderId: order.id,
        // Три кнопки, ровно в порядке утверждённого шаблона v2. Число payload
        // обязано совпадать с числом кнопок в шаблоне, иначе Мета отклоняет
        // всю отправку — приглашение не уходит вообще.
        //
        // Средняя появилась потому, что у человека не было способа спросить,
        // что это, не согласившись и не отказавшись: обе прежние кнопки
        // необратимы, и сомневающийся выбирал «не писать мне».
        buttons: [
          { id: `supconfirm|yes|${order.id}`, text: lang === "kk" ? "Қызығамын, аламын" : "Интересно, беру" },
          { id: `supconfirm|what|${order.id}`, text: lang === "kk" ? "Бұл не?" : "Что это такое?" },
          { id: `supconfirm|no|${order.id}`, text: lang === "kk" ? "Жазбаңыздар" : "Не писать мне" },
        ],
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

    await this.sendFullBroadcast(order, supplier, lang);
  }

  /**
   * Можно ли звать этого человека ещё раз.
   *
   * Приглашение едет вместе с заявкой, а «кому уже слали» считается по каждой
   * заявке отдельно — то есть без этой проверки поток заявок превращается в
   * поток приглашений одному и тому же молчащему человеку. Он не нажмёт «не
   * писать мне», он пожалуется на спам, а это стоит рейтинга номера.
   *
   * Провалившиеся отправки не считаем: человек их не видел, и тратить на них
   * попытку — значит наказать его за нашу ошибку. Ровно этот случай уже есть
   * в базе: 15 приглашений 5 августа не ушли из-за неверного канала.
   */
  private async mayInviteAgain(supplierId: string): Promise<boolean> {
    // Считаем ПОПЫТКИ, а не удачные доставки.
    //
    // Здесь стоял фильтр `status: { not: "FAILED" }`, и он обнулял всю
    // защиту. Приглашение уходит со статусом SENT, а через секунду вебхук
    // Меты переводит его в FAILED — значит из подсчёта выпадали ровно те
    // отправки, которые надо было считать в первую очередь. Счётчик всегда
    // показывал ноль, лимит в три попытки не срабатывал ни разу, и пауза в
    // три дня тоже: при нуле отправок функция сразу отвечает «можно».
    //
    // +7 775 238 8228 получил четыре приглашения — 15, 15, 19 и 19 августа,
    // все четыре недоставлены. И получал бы дальше на каждую новую заявку.
    const sent = await this.prisma.notificationLog.findMany({
      where: { supplierId, templateKey: "supplier_cold_invite" },
      select: { createdAt: true, errorMessage: true },
      orderBy: { createdAt: "desc" },
      take: env.supplierInviteMaxAttempts,
    });
    // «Доставить невозможно» — это не человек, который не ответил, а номер без
    // WhatsApp. Ему не поможет ни вторая попытка, ни третья: 31 приглашение
    // из 103 ушло именно в такие номера. Прекращаем сразу, не тратя оставшиеся
    // попытки и не портя качество номера отправителя.
    if (sent.some((s) => s.errorMessage?.includes(UNDELIVERABLE_ERROR_CODE))) return false;
    if (sent.length >= env.supplierInviteMaxAttempts) return false;
    if (sent.length === 0) return true;
    const cooldownMs = env.supplierInviteCooldownDays * 24 * 60 * 60 * 1000;
    return Date.now() - sent[0].createdAt.getTime() >= cooldownMs;
  }

  /** The real dispatch: everything the supplier needs to act, including the
   * client's phone. Only ever reached for a confirmed supplier — see the
   * cold-invite branch in dispatchToSupplier(). */
  private async sendFullBroadcast(
    order: Awaited<ReturnType<MatchingService["loadOrderForDispatch"]>>,
    supplier: { id: string; user: { phone: string } },
    lang: Language,
  ): Promise<void> {
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

  /** A cold supplier tapped "Интересно, беру" on the invite: record the
   * opt-in and hand over the order they just asked about, contact details
   * and all. Quiet hours are deliberately ignored here — they pressed the
   * button themselves, so waiting until morning to answer would be absurd.
   * Quota still applies: from this point on it's a normal lead. */
  async confirmColdSupplier(supplierId: string, orderId: string): Promise<ColdConfirmResult> {
    const supplier = await this.prisma.supplierProfile.findUnique({
      where: { id: supplierId },
      include: { user: true },
    });
    if (!supplier) return { outcome: "unknown_supplier", alreadyConfirmed: false };

    const alreadyConfirmed = !!supplier.confirmedAt;
    if (!alreadyConfirmed) {
      await this.prisma.supplierProfile.update({
        where: { id: supplierId },
        data: { confirmedAt: new Date() },
      });
    }

    // Согласие без привязки к заявке: человек ответил на приглашение,
    // пришедшее не из рассылки, а из разговора (см. replyToSupplier в
    // роутере). Подключить его надо, а рассказывать про несуществующую
    // заявку — нет.
    if (!orderId) return { outcome: "no_order", alreadyConfirmed };

    // Раньше эта ветка просто молча выходила, и человек, нажавший «Интересно,
    // беру», получал общее «будем присылать заявки» — без единого слова о
    // заявке, которую он только что взял. Он ждал телефон клиента, ничего не
    // получил и жал кнопку второй раз. Возвращаем причину, чтобы роутер мог
    // сказать правду.
    const anchor = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (anchor?.status !== "PUBLISHED") return { outcome: "order_closed", alreadyConfirmed };

    const canNotify = await this.billing.checkAndConsumeQuota(supplierId);
    if (!canNotify) {
      await this.billing.maybeSendQuotaReminder(supplierId, supplier.user.phone);
      return { outcome: "quota_exceeded", alreadyConfirmed };
    }

    const order = await this.loadOrderForDispatch(orderId);
    await this.sendFullBroadcast(order, supplier, toLang(supplier.user.preferredLanguage));
    this.realtime.emitOrderUpdated(orderId, await this.orders.toDto(orderId));
    return { outcome: "order_sent", alreadyConfirmed };
  }

  private async loadOrderForDispatch(orderId: string) {
    return this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { category: true, client: { include: { user: true } } },
    });
  }

  /** Called once a PROSPECT-onboarded supplier finishes registration (see
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

    // Берём всех подходящих, а не первые limit: очередь строится по давности
    // контакта, и обрезать список до сортировки значит обрезать не тех.
    // Кандидатов в одной категории и городе — десятки, не десятки тысяч.
    const matching = await this.prisma.supplierProfile.findMany({
      where: {
        isBlocked: false,
        activityStatus: "ACTIVE",
        id: { notIn: excludeIds },
        categories: { some: { categoryId: order.categoryId } },
        // Both sides are canonicalised through the city dictionary before
        // storage, so this is a set membership test rather than fuzzy
        // matching: the order's own city plus any metro area that lists it
        // as a satellite (a supplier in Астана covers Косшы). Still
        // case-insensitive as a belt-and-braces for rows written before
        // canonicalisation existed.
        ...(order.city
          ? { serviceAreas: { some: { OR: citiesServing(order.city).map((c) => ({ city: { equals: c, mode: "insensitive" as const } })) } } }
          : {}),
        // acceptsUrgent is collected at onboarding specifically so suppliers
        // can opt out of rush jobs — only worth enforcing for urgent orders;
        // non-urgent dispatch shouldn't care either way.
        ...(order.urgent ? { acceptsUrgent: true } : {}),
      },
      include: { user: true },
    });

    return this.rotateFairly(matching, limit);
  }

  /**
   * Очередь по давности контакта, а не по фиксированному порядку.
   *
   * Раньше кандидаты сортировались по рейтингу, а рейтинг у всех холодных
   * поставщиков нулевой — то есть порядок задавала база и он не менялся от
   * заявки к заявке. Первые в списке получали каждую заявку, остальные не
   * получали ни одной: при 19 манипуляторщиках и волне на 15 четверо не
   * увидели ни заявку 76, ни любую следующую. Это не отбор лучших, это
   * случайное везение, закреплённое навсегда.
   *
   * Сортируем по времени последней отправки: кто дольше всех ничего не
   * получал, идёт первым. Ни разу не получавшие — впереди всех.
   *
   * Побочный полезный эффект: те, кому недавно писали, оказываются в конце
   * очереди — а это ровно те, кого отсеет пауза между приглашениями
   * (mayInviteAgain). Иначе они занимали бы места в волне и молча съедали
   * их: сообщение не ушло бы никому.
   *
   * Равные позиции перемешиваем. Без этого пятьдесят человек, которым мы
   * никогда не писали, снова выстроились бы в том порядке, в каком их
   * вернула база, и «равные шансы» опять достались бы первым.
   */
  private async rotateFairly<T extends { id: string }>(candidates: T[], limit: number): Promise<T[]> {
    if (candidates.length <= limit) return candidates;

    const lastSent = await this.prisma.notificationLog.groupBy({
      by: ["supplierId"],
      where: {
        supplierId: { in: candidates.map((c) => c.id) },
        templateKey: { in: ["order_broadcast_full", "order_digest", "supplier_cold_invite"] },
      },
      _max: { createdAt: true },
    });
    const lastBySupplier = new Map(
      lastSent.map((r) => [r.supplierId as string, r._max.createdAt?.getTime() ?? 0]),
    );

    return candidates
      .map((c) => ({ c, last: lastBySupplier.get(c.id) ?? 0, jitter: Math.random() }))
      .sort((a, b) => a.last - b.last || a.jitter - b.jitter)
      .slice(0, limit)
      .map((x) => x.c);
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
