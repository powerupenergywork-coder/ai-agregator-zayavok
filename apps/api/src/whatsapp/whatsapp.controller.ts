import { Body, Controller, Get, HttpCode, Logger, Post, Query, Res, UnauthorizedException, Headers } from "@nestjs/common";
import type { Response } from "express";
import { env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { normalizePhone } from "../common/phone.util";
import { WhatsAppRouterService } from "./whatsapp-router.service";
import { chatIdToPhone } from "./whatsapp.util";

/**
 * GREEN-API delivers every event type (message status, calls, quota, …) to
 * this one URL — we only act on incomingMessageReceived and 200 everything
 * else so it stops retrying/queuing them.
 */
@Controller("whatsapp")
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    private readonly router: WhatsAppRouterService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Входящее — в стенограмму. Пишем до разбора: сообщение, которое бот не
   * понял или на котором упал, нужнее всего, а именно оно и терялось бы,
   * если записывать после успешной обработки.
   */
  private async recordInbound(phone: string, message: any) {
    const kind =
      message.type === "button" || message.type === "interactive" ? "button_reply" : String(message.type ?? "unknown");
    const text =
      message.text?.body ?? message.button?.text ?? message.interactive?.button_reply?.title ?? undefined;
    const payload =
      message.button?.payload ?? message.interactive?.button_reply?.id ?? message.image?.id ?? undefined;
    try {
      await this.prisma.whatsAppMessage.create({
        data: { phone: normalizePhone(phone), direction: "IN", kind, text, payload },
      });
    } catch (err) {
      this.logger.warn(`Не удалось записать входящее в стенограмму: ${(err as Error).message}`);
    }
  }

  /**
   * Статус доставки приходит асинхронно и до сих пор жил только в логах
   * контейнера, которые перетираются. Переносим его в NotificationLog, иначе
   * в админке у неполученного сообщения так и стоит «отправлено».
   */
  private async applyDeliveryStatus(providerMessageId: string, status: string, errors: string) {
    if (!providerMessageId) return;
    const data: Record<string, unknown> = {};
    if (status === "failed") {
      data.status = "FAILED";
      data.errorMessage = errors || "Мета отказала в доставке";
    } else if (status === "delivered") {
      data.deliveredAt = new Date();
    } else if (status === "read") {
      data.readAt = new Date();
    } else {
      return; // "sent" уже отражён самим фактом записи
    }
    try {
      // updateMany, а не update: у сообщений, отправленных мимо
      // NotificationsService (ответы роутера), записи там нет — и это норма.
      await this.prisma.notificationLog.updateMany({ where: { providerMessageId }, data });
    } catch (err) {
      this.logger.warn(`Не удалось обновить статус доставки: ${(err as Error).message}`);
    }
  }

  @Post("webhook")
  @HttpCode(200)
  async webhook(@Headers("authorization") authHeader: string | undefined, @Body() body: any): Promise<{ ok: true }> {
    this.assertAuthorized(authHeader);

    if (body?.typeWebhook !== "incomingMessageReceived") {
      return { ok: true };
    }

    const chatId: string | undefined = body?.senderData?.chatId;
    if (!chatId || chatId.endsWith("@g.us")) {
      // Ignore group chats — the bot only handles 1:1 conversations.
      return { ok: true };
    }
    const phone = chatIdToPhone(chatId);
    const messageData = body?.messageData ?? {};

    try {
      if (messageData.typeMessage === "textMessage") {
        await this.router.handleIncoming({ chatId, phone, text: messageData.textMessageData?.textMessage });
      } else if (messageData.typeMessage === "extendedTextMessage") {
        await this.router.handleIncoming({ chatId, phone, text: messageData.extendedTextMessageData?.text });
      } else if (messageData.typeMessage === "templateButtonsReplyMessage") {
        await this.router.handleIncoming({
          chatId,
          phone,
          buttonReplyId: messageData.templateButtonReplyMessage?.selectedId,
        });
      } else if (messageData.typeMessage === "imageMessage") {
        await this.router.handleIncoming({ chatId, phone, imageUrl: messageData.fileMessageData?.downloadUrl });
      }
    } catch (err) {
      // Webhook still 200s — GREEN-API would otherwise keep retrying a message
      // we've already logged and given up on; errors are visible in our logs.
      this.logger.error(`webhook handling failed: ${(err as Error).message}`);
    }

    return { ok: true };
  }

  private assertAuthorized(authHeader: string | undefined) {
    const expected = env.whatsappWebhookToken;
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    if (!expected || token !== expected) {
      throw new UnauthorizedException("Invalid webhook token");
    }
  }

  /**
   * Meta's one-time webhook verification handshake, done when you save the
   * callback URL in the app dashboard: echo back hub.challenge iff
   * hub.verify_token matches what we configured there.
   */
  @Get("cloud-webhook")
  verifyCloudWebhook(
    @Query("hub.mode") mode: string | undefined,
    @Query("hub.verify_token") token: string | undefined,
    @Query("hub.challenge") challenge: string | undefined,
    @Res() res: Response,
  ) {
    if (mode === "subscribe" && token === env.whatsappCloudWebhookVerifyToken && challenge) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send("Forbidden");
  }

  /**
   * Meta Cloud API delivers messages and status callbacks (sent/delivered/
   * read/failed) to this one URL — we route inbound messages and 200
   * everything else so Meta stops retrying.
   */
  @Post("cloud-webhook")
  @HttpCode(200)
  async cloudWebhook(@Body() body: any): Promise<{ ok: true }> {
    const value = body?.entry?.[0]?.changes?.[0]?.value;

    // Статус доставки — единственное место, где видно, что сообщение не дошло.
    // NotificationLog.status=SENT означает лишь «Мета приняла запрос»: отказ
    // на её стороне (нет WhatsApp у номера, блокировка, лимит) приходит
    // только сюда. Раньше эти колбэки молча выбрасывались, и провал доставки
    // не было видно вообще нигде.
    const status = value?.statuses?.[0];
    if (status) {
      const errors = (status.errors ?? [])
        .map((e: any) => [e.code, e.title, e.error_data?.details].filter(Boolean).join(" — "))
        .join("; ");
      const who = status.recipient_id ?? "?";
      if (status.status === "failed") {
        this.logger.error(`Доставка на ${who}: FAILED ${errors || "без пояснения"} (id ${status.id})`);
      } else {
        this.logger.log(`Доставка на ${who}: ${status.status} (id ${status.id})`);
      }
      await this.applyDeliveryStatus(status.id, status.status, errors);
    }

    const message = value?.messages?.[0];
    if (!message) return { ok: true };

    const phone = chatIdToPhone(message.from);
    const chatId = `${message.from}@c.us`;
    await this.recordInbound(phone, message);

    try {
      if (message.type === "text") {
        await this.router.handleIncoming({ chatId, phone, text: message.text?.body });
      } else if (message.type === "button") {
        // Нажатие quick-reply в ШАБЛОНЕ приходит именно так: type "button" и
        // payload, а не interactive.button_reply — тот бывает только у
        // интерактивных сообщений, то есть внутри открытого 24-часового окна.
        // Первое касание с клиентом или холодным поставщиком всегда идёт
        // шаблоном, поэтому без этой ветки были мертвы все кнопки: и
        // «Подтвердить» под заявкой, и «Интересно, беру» в приглашении.
        // Нажатие доходило до вебхука и молча выбрасывалось.
        await this.router.handleIncoming({ chatId, phone, buttonReplyId: message.button?.payload });
      } else if (message.type === "interactive" && message.interactive?.type === "button_reply") {
        await this.router.handleIncoming({ chatId, phone, buttonReplyId: message.interactive.button_reply?.id });
      } else if (message.type === "image") {
        // Cloud API gives an opaque media id, not a URL — CloudApiProvider's
        // downloadMedia() knows to resolve this id via the Graph API instead.
        await this.router.handleIncoming({ chatId, phone, imageUrl: message.image?.id });
      } else {
        // Стикер, голосовое, документ. Молчать нельзя: человек видит, что
        // сообщение доставлено, и ждёт ответа — в живой переписке это
        // выглядит как «меня игнорируют». Одной строки достаточно.
        this.logger.warn(`Необработанный тип входящего сообщения: ${message.type}`);
        await this.router.replyUnsupportedType(phone);
      }
    } catch (err) {
      this.logger.error(`cloud webhook handling failed: ${(err as Error).message}`);
    }

    return { ok: true };
  }
}
