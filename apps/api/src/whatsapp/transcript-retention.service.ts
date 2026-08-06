import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { env } from "../config/env";

/**
 * Стенограмма переписки — персональные данные, и хранить её бессрочно нет ни
 * основания, ни смысла: разбор «где человек застрял» происходит по горячим
 * следам, а не через полгода.
 *
 * Чистится только WhatsAppMessage. NotificationLog остаётся: это деловая
 * запись о факте отправки и доставке, привязанная к заявке. ChatMessage тоже
 * остаётся — он показывается в самой карточке заявки, и его удаление стёрло
 * бы клиенту историю его же диалога.
 */
@Injectable()
export class TranscriptRetentionService {
  private readonly logger = new Logger(TranscriptRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Каждую ночь в 03:30 — время выбрано вне тихих часов рассылки, чтобы
   * тяжёлое удаление не совпадало с утренним разбором отложенных дайджестов. */
  @Cron("30 3 * * *")
  async purgeOldMessages(): Promise<void> {
    const days = env.whatsappTranscriptRetentionDays;
    if (days <= 0) return; // 0 = хранить бессрочно, осознанный выключатель

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.whatsAppMessage.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (count > 0) {
      this.logger.log(`Стенограмма: удалено ${count} сообщений старше ${days} дн.`);
    }
  }
}
