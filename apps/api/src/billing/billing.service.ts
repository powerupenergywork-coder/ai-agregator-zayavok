import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { env } from "../config/env";
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
    await this.prisma.supplierSubscription.update({
      where: { id: sub.id },
      data: { status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: periodEnd },
    });
    await this.notifications.send({
      event: "subscription_activated",
      payload: { periodDays: env.subscriptionPeriodDays },
      recipientPhone: sub.supplier.user.phone,
      supplierId: sub.supplierId,
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
    const { paymentUrl } = await this.requestSubscription(supplierId);
    await this.notifications.send({
      event: "quota_exceeded",
      payload: { freeQuota: env.freeNotificationsPerMonth, paymentUrl },
      recipientPhone: phone,
      supplierId,
      buttons: [{ id: "billing|subscribe", text: "Оформить подписку" }],
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
