import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { randomInt, randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { env, kaspiBillerActive, kaspiPayUrl, paymentsEnabled } from "../config/env";
import { PAYMENT_PROVIDER, PaymentProvider } from "./payment-provider.interface";

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
    return result.count > 0;
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
    if (kaspiBillerActive()) {
      const invoice = await this.issueInvoice(supplierId);
      await this.notifications.send({
        event: "quota_exceeded",
        payload: {
          freeQuota: env.freeNotificationsPerMonth,
          invoiceNumber: invoice.number,
          payUrl: kaspiPayUrl(invoice.number),
          kaspiServiceName: env.kaspiServiceName,
          priceTenge: invoice.amountTenge,
          periodDays: invoice.periodDays,
          supportPhone: env.supportPhone,
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

  /** 1st of every month — resets everyone's free-tier counter. Active paid subscriptions are untouched (they run on their own 30-day clock). */
  @Cron("0 0 1 * *")
  async resetMonthlyQuotas(): Promise<void> {
    const result = await this.prisma.supplierProfile.updateMany({
      data: { notificationsUsedThisMonth: 0, quotaResetAt: new Date() },
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
