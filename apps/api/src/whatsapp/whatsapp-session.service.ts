import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface PendingOptions {
  pendingOptions?: Record<string, string>;
}

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
