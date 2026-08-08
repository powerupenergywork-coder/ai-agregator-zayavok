import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsAppReferral } from "./whatsapp.types";

export interface PendingOptions {
  pendingOptions?: Record<string, string>;
}

/**
 * Сколько дней клик по рекламе считается причиной заявки. Человек, кликнувший
 * объявление и написавший в тот же час, пришёл из рекламы; тот же человек,
 * вернувшийся через полгода, пришёл сам, и записывать его в результат кампании
 * значит завысить её эффект и переплатить за следующую.
 *
 * Семь дней — обычное для отрасли окно, у нас почти все диалоги начинаются в
 * первые минуты после клика.
 */
export const AD_ATTRIBUTION_WINDOW_DAYS = 7;

@Injectable()
export class WhatsAppSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreate(chatId: string, phone: string) {
    return this.prisma.whatsAppSession.upsert({
      where: { chatId },
      create: { chatId, phone },
      update: {},
    });
  }

  /**
   * Запомнить клик по рекламе. Перезаписываем предыдущий: если человек кликнул
   * второе объявление, заявку принесло именно оно (last click).
   */
  async recordAdReferral(chatId: string, referral: WhatsAppReferral) {
    await this.prisma.whatsAppSession.update({
      where: { chatId },
      data: {
        // "ad" и "post" — единственные значения source_type у Meta. Нормализуем
        // в те же имена источников, что пишет веб-атрибуция, иначе один и тот
        // же канал будет лежать в отчёте под двумя названиями.
        adSource: referral.sourceType === "post" ? "meta_post" : "meta_ads",
        adParams: referral as object,
        adAt: new Date(),
      },
    });
  }

  /**
   * Атрибуция для заявки, заводимой в этом чате: источник, если клик был
   * достаточно недавно, иначе ничего.
   */
  adAttribution(session: { adSource: string | null; adParams: unknown; adAt: Date | null }):
    | { source: string; sourceParams: Record<string, string> }
    | undefined {
    if (!session.adSource || !session.adAt) return undefined;
    const ageDays = (Date.now() - session.adAt.getTime()) / (24 * 60 * 60 * 1000);
    if (ageDays > AD_ATTRIBUTION_WINDOW_DAYS) return undefined;

    const params = (session.adParams ?? {}) as Record<string, unknown>;
    const sourceParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && value) sourceParams[key] = value.slice(0, 120);
    }
    return { source: session.adSource, sourceParams };
  }

  async setCurrentOrder(chatId: string, orderId: string) {
    await this.prisma.whatsAppSession.update({ where: { chatId }, data: { currentOrderId: orderId } });
  }

  async setPendingOptions(chatId: string, pendingOptions: Record<string, string> | undefined) {
    await this.prisma.whatsAppSession.update({
      where: { chatId },
      data: { stateData: pendingOptions ? { pendingOptions } : {} },
    });
  }

  async clearOrder(chatId: string) {
    await this.prisma.whatsAppSession.update({
      where: { chatId },
      data: { currentOrderId: null, stateData: {} },
    });
  }

  /**
   * Called when a supplier-onboarding conversation finishes — back to ordinary
   * client-order handling. Deliberately leaves currentOrderId untouched: if
   * this phone had an order draft in progress before switching into
   * onboarding (e.g. typed "поставщик" mid-conversation), it's still there.
   */
  async resetToOrderFlow(chatId: string) {
    await this.prisma.whatsAppSession.update({
      where: { chatId },
      data: { flow: "client_order", stateData: {} },
    });
  }

  async setFlow(chatId: string, flow: string, stateData: unknown) {
    await this.prisma.whatsAppSession.update({ where: { chatId }, data: { flow, stateData: stateData as any } });
  }
}
