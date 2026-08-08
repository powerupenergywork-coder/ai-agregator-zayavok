import { Injectable } from "@nestjs/common";
import { LocalizedText } from "@ai-zayavki/shared";
import { PrismaService } from "../prisma/prisma.service";
import { env } from "../config/env";

/**
 * Цифры для страницы исполнителей. Только количественные: сами заявки наружу
 * не показываем — по ним видно, чем живёт сервис, и это не та информация,
 * которой стоит делиться с кем попало.
 *
 * Отдельно про порог. Пока заявок мало, «за неделю: 3» отталкивает сильнее,
 * чем убеждает отсутствие цифры вовсе — исполнитель делает вывод, что работы
 * нет, и уходит. Поэтому блок спроса не показывается, пока число не станет
 * осмысленным, и включится сам, когда станет. Врать при этом не приходится:
 * мы не показываем ничего вместо того, чтобы показывать приукрашенное.
 */
@Injectable()
export class PublicService {
  constructor(private readonly prisma: PrismaService) {}

  async supplierStats() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [suppliers, ordersWeek, categories, cities] = await Promise.all([
      this.prisma.supplierProfile.count({ where: { isBlocked: false } }),
      this.prisma.order.count({ where: { publishedAt: { gt: weekAgo } } }),
      this.prisma.category.findMany({ where: { isActive: true }, select: { slug: true, name: true } }),
      this.prisma.serviceArea.findMany({ select: { city: true }, distinct: ["city"] }),
    ]);

    return {
      suppliers,
      categories: categories.map((c) => ({
        slug: c.slug,
        name: c.name as unknown as LocalizedText,
      })),
      cities: cities.map((c) => c.city),
      // null = показывать нечего, блок спроса на странице просто не рисуется.
      ordersLastWeek: ordersWeek >= env.publicStatsMinOrders ? ordersWeek : null,
      freeQuota: env.freeNotificationsPerMonth,
      priceTenge: env.subscriptionPriceTenge,
      periodDays: env.subscriptionPeriodDays,
      botPhone: env.whatsappBotPhone,
    };
  }
}
