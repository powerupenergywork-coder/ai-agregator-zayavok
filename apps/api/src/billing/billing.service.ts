import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { randomInt, randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { env, kaspiBillerActive, kaspiPayUrl, paymentsEnabled, toleActive } from "../config/env";
import { PAYMENT_PROVIDER, PaymentProvider } from "./payment-provider.interface";
import { ToleBillerService } from "./tole-biller.service";
import { NewOrderAlertService } from "../orders/new-order-alert.service";

interface SubscriptionLike {
  status: string;
  currentPeriodEnd: Date | null;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly toleBiller: ToleBillerService,
    private readonly ownerAlert: NewOrderAlertService,
    @Inject(PAYMENT_PROVIDER) private readonly payment: PaymentProvider,
  ) {}

  isSubscriptionActive(sub: SubscriptionLike | null | undefined): boolean {
    return !!sub && sub.status === "ACTIVE" && !!sub.currentPeriodEnd && sub.currentPeriodEnd > new Date();
  }

  async getStatus(supplierId: string) {
    const supplier = await this.prisma.supplierProfile.findUniqueOrThrow({
      where: { id: supplierId },
      include: { subscription: true },
    });
    return {
      notificationsUsedThisMonth: supplier.notificationsUsedThisMonth,
      freeQuota: env.freeNotificationsPerMonth,
      remainingFree: Math.max(env.freeNotificationsPerMonth - supplier.notificationsUsedThisMonth, 0),
      subscriptionActive: this.isSubscriptionActive(supplier.subscription),
      subscriptionExpiresAt: supplier.subscription?.currentPeriodEnd ?? null,
      priceTenge: env.subscriptionPriceTenge,
      periodDays: env.subscriptionPeriodDays,
    };
  }

  async requestSubscription(supplierId: string): Promise<{ paymentUrl: string }> {
    const reference = randomUUID();
    await this.prisma.supplierSubscription.upsert({
      where: { supplierId },
      create: { supplierId, paymentReference: reference, paymentProvider: env.paymentProvider },
      update: { paymentReference: reference, paymentProvider: env.paymentProvider },
    });
    return this.payment.createPayment({
      amountTenge: env.subscriptionPriceTenge,
      description: `Подписка на уведомления о заявках — ${env.subscriptionPeriodDays} дней`,
      reference,
    });
  }

  /** Called by the payment webhook (or the mock-confirm dev route) once money has actually moved. */
  async confirmPayment(reference: string): Promise<void> {
    const sub = await this.prisma.supplierSubscription.findUnique({
      where: { paymentReference: reference },
      include: { supplier: { include: { user: true } } },
    });
    if (!sub) throw new NotFoundException("Платёж не найден");

    const now = new Date();
    const periodEnd = new Date(now.getTime() + env.subscriptionPeriodDays * 24 * 60 * 60 * 1000);
    // Payment providers retry a callback until they get a 200, so the same
    // reference arrives more than once as a matter of routine. Clearing it
    // here makes the second delivery a no-op instead of another free month:
    // the lookup above is by reference, and only one caller can win the
    // conditional update.
    const consumed = await this.prisma.supplierSubscription.updateMany({
      where: { id: sub.id, paymentReference: reference },
      data: { status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: periodEnd, paymentReference: null },
    });
    if (consumed.count === 0) {
      this.logger.log(`Повторный вебхук по ${reference} — платёж уже подтверждён, пропускаю`);
      return;
    }
    await this.notifications.send({
      event: "subscription_activated",
      payload: { periodDays: env.subscriptionPeriodDays },
      recipientPhone: sub.supplier.user.phone,
      supplierId: sub.supplierId,
    });
  }

  /**
   * Счёт, который поставщик назовёт в Kaspi. Один и тот же, пока не оплачен и
   * не протух: напоминание о лимите приходит не раз, и новый номер на каждое
   * означал бы, что человек, вернувшийся к вчерашнему сообщению, платит по
   * счёту, о котором мы уже забыли.
   */
  async issueInvoice(supplierId: string) {
    const now = new Date();
    const open = await this.prisma.subscriptionInvoice.findFirst({
      where: { supplierId, status: "PENDING", expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
    });
    if (open) return open;

    return this.prisma.subscriptionInvoice.create({
      data: {
        number: await this.freeInvoiceNumber(),
        supplierId,
        amountTenge: env.subscriptionPriceTenge,
        periodDays: env.subscriptionPeriodDays,
        expiresAt: new Date(now.getTime() + env.invoiceValidDays * 24 * 60 * 60 * 1000),
      },
    });
  }

  /**
   * Счёт и способ его оплаты — одним куском для шаблона сообщения.
   *
   * Три места шлют человеку счёт: лимит исчерпан, подписка заканчивается,
   * подписка закончилась. Способ оплаты у них обязан быть один и тот же, а
   * был переписан заново в каждом — поэтому он здесь, а не там.
   *
   * Когда включён Tole, счёт ещё и уходит в приложение Kaspi исполнителя
   * прямо отсюда. Если выставить не удалось, в сообщении останется телефон
   * поддержки: номер счёта, который нигде не оплатить, хуже, чем его
   * отсутствие — ровно это сейчас и происходит у биллера, которого Kaspi
   * так и не запустил.
   */
  async invoicePayload(supplierId: string, phone: string): Promise<Record<string, unknown>> {
    const invoice = await this.issueInvoice(supplierId);

    if (toleActive()) {
      const delivered = await this.toleBiller.deliverInvoice(invoice, phone);
      return delivered
        ? {
            toleInvoice: true,
            priceTenge: invoice.amountTenge,
            periodDays: invoice.periodDays,
            supportPhone: env.supportPhone,
          }
        : { supportPhone: env.supportPhone };
    }

    return {
      invoiceNumber: invoice.number,
      payUrl: kaspiPayUrl(invoice.number, invoice.amountTenge),
      kaspiServiceName: env.kaspiServiceName,
      priceTenge: invoice.amountTenge,
      periodDays: invoice.periodDays,
      supportPhone: env.supportPhone,
    };
  }

  /**
   * Событие вебхука Tole.
   *
   * Идентификатора платежа в теле события нет — по их же схеме, — поэтому
   * событие здесь только повод сверить открытые счета. Повтор отбивается
   * первичным ключом: Tole доставляет событие, пока не получит 2xx.
   */
  async handleToleEvent(event: { id: string; type: string; data: unknown }): Promise<void> {
    const seen = await this.prisma.tolePaymentEvent.findUnique({ where: { id: event.id } });
    if (seen) {
      this.logger.log(`Событие Tole ${event.id} уже обработано, пропускаю`);
      return;
    }
    await this.prisma.tolePaymentEvent.create({
      data: { id: event.id, type: event.type, payload: (event.data ?? {}) as never },
    });
    // Возвраты и отмены сверка тоже увидит, но подписку по ним не трогаем:
    // деньги вернулись — разбирается человек, а не автомат.
    if (!event.type.startsWith("payment.")) return;
    await this.reconcileToleInvoices();
  }

  /**
   * Сверка открытых счетов Tole: кто заплатил, пока мы не смотрели.
   *
   * Это основной путь зачисления, а не запасной. Вебхук — только сигнал
   * «пора посмотреть»; потерянный вебхук означает задержку до следующей
   * сверки, а не потерянные деньги.
   */
  @Cron("*/10 * * * *")
  async reconcileToleInvoices(): Promise<number> {
    // Условие про ключ, а не про TOLE_ENABLED. Флаг решает, выставлять ли НОВЫЕ
    // счета; уже выставленный человек может оплатить и на следующий день после
    // того, как мы вернулись к биллеру, — эти деньги обязаны дойти.
    if (!env.toleApiKey) return 0;

    const open = await this.prisma.subscriptionInvoice.findMany({
      where: { provider: "tole", status: "PENDING", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    let paid = 0;
    for (const invoice of open) {
      try {
        // Счёт, про который Tole ответил «ещё выполняется»: сначала узнаём,
        // чем кончилось, иначе сверять нечего.
        const externalId = invoice.externalId ?? (await this.toleBiller.resolveCommand(invoice));
        if (!externalId) continue;

        const state = await this.toleBiller.paymentStatus(externalId);
        if (!state?.paid) continue;
        if (await this.applyTolePayment(invoice, state.amountTenge)) paid++;
      } catch (err) {
        this.logger.error(`Сверка счёта №${invoice.number} не удалась: ${(err as Error).message}`);
      }
    }
    if (paid) this.logger.log(`Сверка Tole: зачтено платежей — ${paid}`);
    return paid;
  }

  /**
   * Зачесть оплаченный счёт Tole.
   *
   * Условие `status: "PENDING"` в updateMany — это замок, а не проверка
   * перед записью: сверка по расписанию и сверка по вебхуку могут идти
   * одновременно, и без него один платёж продлил бы подписку дважды.
   */
  private async applyTolePayment(
    invoice: { id: string; number: string; supplierId: string; amountTenge: number; periodDays: number },
    paidTenge: number,
  ): Promise<boolean> {
    const claimed = await this.prisma.subscriptionInvoice.updateMany({
      where: { id: invoice.id, status: "PENDING" },
      data: { status: "PAID", paidAt: new Date(), paidAmountTenge: paidTenge },
    });
    if (claimed.count === 0) return false;

    // Дней столько, за сколько заплатили — как у биллера. Сумму называем мы,
    // но если дойдёт другая, оба простых варианта плохи: отказать после
    // списания или подарить полный период за половину денег.
    const perDay = invoice.amountTenge / invoice.periodDays;
    const days = Math.max(1, Math.floor(paidTenge / perDay));
    await this.extendSubscription(invoice.supplierId, days, "tole");
    this.logger.log(`Счёт №${invoice.number} оплачен через Tole: ${paidTenge} ₸, ${days} дн.`);
    return true;
  }

  /**
   * Восемь цифр, случайных. По порядку нельзя: соседний номер — чужой счёт,
   * и «оплатить не свой» превратилось бы в опечатку в последней цифре.
   * Коллизия маловероятна, но проверяется, а не принимается на веру.
   */
  private async freeInvoiceNumber(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const n = String(randomInt(10_000_000, 100_000_000));
      const taken = await this.prisma.subscriptionInvoice.findUnique({ where: { number: n } });
      if (!taken) return n;
    }
    throw new Error("Не удалось подобрать свободный номер счёта");
  }

  /**
   * Продлить подписку на N дней. Точка входа для Kaspi, где платёж приходит
   * сам, без нашего createPayment() и без reference.
   *
   * Считаем от конца текущего периода, а не от «сейчас»: поставщик, оплативший
   * за неделю до окончания, иначе терял бы эту неделю — и совершенно
   * справедливо считал бы, что его обсчитали. От «сейчас» отсчитываем только
   * если подписка уже истекла.
   */
  async extendSubscription(supplierId: string, days: number, provider: string): Promise<void> {
    const supplier = await this.prisma.supplierProfile.findUniqueOrThrow({
      where: { id: supplierId },
      include: { subscription: true, user: true },
    });
    const now = new Date();
    const current = supplier.subscription?.currentPeriodEnd;
    const base = current && current > now ? current : now;
    const periodEnd = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

    await this.prisma.supplierSubscription.upsert({
      where: { supplierId },
      create: {
        supplierId,
        status: "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        paymentProvider: provider,
      },
      update: {
        status: "ACTIVE",
        currentPeriodStart: supplier.subscription?.currentPeriodStart ?? now,
        currentPeriodEnd: periodEnd,
        paymentProvider: provider,
        // Новый период — новое предупреждение. Без сброса поставщик, продливший
        // подписку однажды, больше никогда бы не узнал о её окончании.
        expiryNoticeAt: null,
      },
    });

    await this.notifications.send({
      event: "subscription_activated",
      payload: { periodDays: days, expiresAt: periodEnd.toLocaleDateString("ru-RU") },
      recipientPhone: supplier.user.phone,
      supplierId,
    });
  }

  /** True = go ahead and send the notification (and, if this was a free-quota send, count it). */
  /** Two orders dispatching to the same supplier at nearly the same moment
   * must not both slip through on the last free slot — the quota check and
   * the increment have to be one atomic statement, not read-then-write
   * (same race class as the offer-claim fix elsewhere in this codebase). */
  async checkAndConsumeQuota(supplierId: string): Promise<boolean> {
    const supplier = await this.prisma.supplierProfile.findUniqueOrThrow({
      where: { id: supplierId },
      include: { subscription: true },
    });
    if (this.isSubscriptionActive(supplier.subscription)) return true;

    const result = await this.prisma.supplierProfile.updateMany({
      where: { id: supplierId, notificationsUsedThisMonth: { lt: env.freeNotificationsPerMonth } },
      data: { notificationsUsedThisMonth: { increment: 1 } },
    });
    if (result.count > 0) await this.warnOwnerIfNearQuota(supplierId);
    return result.count > 0;
  }

  /**
   * Сказать владельцу, что исполнитель подходит к бесплатному лимиту.
   *
   * Смысл предупреждения в запасе времени: когда лимит кончится, бот
   * предложит платить, а подключить приём денег за один вечер не выйдет.
   *
   * Один раз на исполнителя в месяц. Замок — условие `quotaAlertAt: null`
   * в самом updateMany: две заявки, дошедшие до порога одновременно, иначе
   * дали бы два одинаковых сообщения. Отметка сбрасывается первого числа
   * вместе со счётчиком.
   *
   * Ошибка здесь не должна остановить рассылку заявки: человек ждёт
   * заказ, а не наше уведомление самим себе.
   */
  private async warnOwnerIfNearQuota(supplierId: string): Promise<void> {
    if (env.quotaAlertThreshold <= 0) return;
    try {
      const claimed = await this.prisma.supplierProfile.updateMany({
        where: {
          id: supplierId,
          quotaAlertAt: null,
          notificationsUsedThisMonth: { gte: env.quotaAlertThreshold },
        },
        data: { quotaAlertAt: new Date() },
      });
      if (claimed.count === 0) return;

      const supplier = await this.prisma.supplierProfile.findUniqueOrThrow({
        where: { id: supplierId },
        include: { user: true },
      });
      await this.ownerAlert.alertQuotaNearLimit({
        companyName: supplier.companyName,
        phone: supplier.user.phone,
        used: supplier.notificationsUsedThisMonth,
        quota: env.freeNotificationsPerMonth,
      });
      this.logger.log(`Владельцу сказано о лимите: ${supplierId}`);
    } catch (err) {
      this.logger.error(`Оповещение о лимите не удалось: ${(err as Error).message}`);
    }
  }

  /** Rate-limited to once/day per supplier so a busy category doesn't spam them. */
  async maybeSendQuotaReminder(supplierId: string, phone: string): Promise<void> {
    const supplier = await this.prisma.supplierProfile.findUniqueOrThrow({ where: { id: supplierId } });
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (supplier.lastQuotaReminderAt && supplier.lastQuotaReminderAt > dayAgo) return;

    await this.prisma.supplierProfile.update({ where: { id: supplierId }, data: { lastQuotaReminderAt: new Date() } });

    // Три ветки, потому что способов заплатить три и они не сводятся друг к
    // другу. У Kaspi ссылки нет вовсе — деньги вносятся внутри приложения
    // банка, поэтому шлём инструкцию и не создаём никакого платежа заранее:
    // мы даже не узнаем, что человек собрался платить, пока он не заплатит.
    // Ссылка остаётся для провайдеров со шлюзом. А пока оплаты нет совсем,
    // не шлём ни того ни другого: единственная существующая ссылка ведёт на
    // /billing/mock-confirm, то есть раздаёт платную подписку даром.
    if (kaspiBillerActive() || toleActive()) {
      await this.notifications.send({
        event: "quota_exceeded",
        payload: {
          freeQuota: env.freeNotificationsPerMonth,
          ...(await this.invoicePayload(supplierId, phone)),
        },
        recipientPhone: phone,
        supplierId,
      });
      return;
    }

    const paymentUrl = paymentsEnabled() ? (await this.requestSubscription(supplierId)).paymentUrl : undefined;
    await this.notifications.send({
      event: "quota_exceeded",
      payload: { freeQuota: env.freeNotificationsPerMonth, paymentUrl, supportPhone: env.supportPhone },
      recipientPhone: phone,
      supplierId,
      ...(paymentUrl ? { buttons: [{ id: "billing|subscribe", text: "Оформить подписку" }] } : {}),
    });
  }

  /**
   * Ежедневно: выставить счёт тем, у кого подписка вот-вот кончится или уже
   * кончилась.
   *
   * До этого подписка просто молча заканчивалась. Поставщик узнавал об этом
   * по тому, что заявки перестали приходить — то есть в худший момент и без
   * объяснения, а мы теряли деньги на ровном месте: платить он был готов,
   * просто никто не напомнил.
   *
   * Два разных случая и два разных текста. За несколько дней до конца —
   * «заканчивается, вот счёт», чтобы человек успел заплатить и не потерять
   * ни дня. В день окончания — «закончилась, снова по лимиту», потому что
   * первое сообщение могли не заметить.
   *
   * Утро, а не ночь: это не техническая задача, а сообщение живому человеку.
   */
  @Cron("0 10 * * *", { timeZone: env.dispatchTimezone })
  async issueRenewalInvoices(): Promise<void> {
    const now = new Date();
    const soon = new Date(now.getTime() + env.subscriptionExpiryNoticeDays * 24 * 60 * 60 * 1000);

    // Скоро закончится. expiryNoticeAt = null отбирает тех, кому по текущему
    // периоду ещё не писали: без этого напоминание уходило бы каждый день.
    const expiring = await this.prisma.supplierSubscription.findMany({
      where: {
        status: "ACTIVE",
        currentPeriodEnd: { gt: now, lte: soon },
        expiryNoticeAt: null,
      },
      include: { supplier: { include: { user: true } } },
    });
    for (const sub of expiring) {
      try {
        await this.prisma.supplierSubscription.update({
          where: { id: sub.id },
          data: { expiryNoticeAt: now },
        });
        await this.notifications.send({
          event: "subscription_expiring",
          payload: {
            expiresAt: sub.currentPeriodEnd!.toLocaleDateString("ru-RU"),
            ...(await this.invoicePayload(sub.supplierId, sub.supplier.user.phone)),
          },
          recipientPhone: sub.supplier.user.phone,
          supplierId: sub.supplierId,
        });
      } catch (err) {
        this.logger.error(`Не удалось предупредить об окончании подписки ${sub.supplierId}: ${(err as Error).message}`);
      }
    }

    // Уже закончилась. Смена статуса на EXPIRED и есть защита от повтора:
    // на следующий день эта выборка его уже не увидит.
    const expired = await this.prisma.supplierSubscription.findMany({
      where: { status: "ACTIVE", currentPeriodEnd: { lte: now } },
      include: { supplier: { include: { user: true } } },
    });
    for (const sub of expired) {
      try {
        await this.prisma.supplierSubscription.update({
          where: { id: sub.id },
          data: { status: "EXPIRED" },
        });
        await this.notifications.send({
          event: "subscription_expired",
          payload: {
            freeQuota: env.freeNotificationsPerMonth,
            ...(await this.invoicePayload(sub.supplierId, sub.supplier.user.phone)),
          },
          recipientPhone: sub.supplier.user.phone,
          supplierId: sub.supplierId,
        });
      } catch (err) {
        this.logger.error(`Не удалось сообщить об окончании подписки ${sub.supplierId}: ${(err as Error).message}`);
      }
    }

    if (expiring.length || expired.length) {
      this.logger.log(`Подписки: предупреждено ${expiring.length}, закончилось ${expired.length}`);
    }
  }

  /** 1st of every month — resets everyone's free-tier counter. Active paid subscriptions are untouched (they run on their own 30-day clock). */
  @Cron("0 0 1 * *")
  async resetMonthlyQuotas(): Promise<void> {
    // quotaAlertAt сбрасывается вместе со счётчиком: иначе предупреждение
    // об исполнителе, дошедшем до порога однажды, больше не повторилось бы
    // никогда.
    const result = await this.prisma.supplierProfile.updateMany({
      data: { notificationsUsedThisMonth: 0, quotaResetAt: new Date(), quotaAlertAt: null },
    });
    this.logger.log(`Monthly quota reset for ${result.count} suppliers`);
  }

  /** Operator override for force-majeure/testing — bypasses payment entirely. */
  async adminSetSubscription(supplierId: string, active: boolean): Promise<void> {
    const now = new Date();
    const periodEnd = active ? new Date(now.getTime() + env.subscriptionPeriodDays * 24 * 60 * 60 * 1000) : now;
    await this.prisma.supplierSubscription.upsert({
      where: { supplierId },
      create: {
        supplierId,
        status: active ? "ACTIVE" : "EXPIRED",
        currentPeriodStart: active ? now : null,
        currentPeriodEnd: periodEnd,
        paymentProvider: "admin_override",
      },
      update: {
        status: active ? "ACTIVE" : "EXPIRED",
        currentPeriodStart: active ? now : undefined,
        currentPeriodEnd: periodEnd,
      },
    });
  }
}
