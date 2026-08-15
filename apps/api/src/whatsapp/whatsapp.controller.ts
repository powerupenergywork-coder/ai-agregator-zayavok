import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { createHmac, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
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
/**
 * Лимит запросов здесь снят намеренно.
 *
 * Сюда стучится не человек, а Meta и GREEN-API — с горстки своих адресов и
 * пачками: в час пик все входящие сообщения приходят с одного IP. Упрётся в
 * лимит — мы отдадим 429, отправитель посчитает это сбоем, и сообщение
 * клиента потеряется или придёт с задержкой в несколько минут.
 *
 * Вместо лимита эти маршруты закрыты подписью: Bearer-токен у GREEN-API и
 * X-Hub-Signature-256 у Meta (см. verifyMetaSignature ниже). Считать запросы
 * по адресу тут бессмысленно — их шлёт не тот, от кого мы защищаемся.
 */
@SkipThrottle()
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
  async cloudWebhook(
    @Body() body: any,
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-hub-signature-256") signature?: string,
  ): Promise<{ ok: true }> {
    if (!this.verifyMetaSignature(req.rawBody, signature)) {
      // 200, а не 403: настоящая Meta сюда с плохой подписью не придёт, а
      // чужому не нужно подсказывать, что именно не сошлось.
      this.logger.warn("Вебхук Meta с неверной подписью — проигнорирован");
      return { ok: true };
    }

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

    // Юзернеймы WhatsApp. Если человек включил себе юзернейм, пишет нам впервые
    // и мы не контактировали с ним 30 дней, Meta не присылает ни `from`, ни
    // `wa_id` — только BSUID в `from_user_id`. Обработать такое сообщение нам
    // сейчас нечем: и роутер, и сессии, и главное — передача номера заказчика
    // исполнителю построены на телефоне.
    //
    // Но упасть здесь нельзя. Строка ниже до апреля 2026 гарантированно
    // получала строку, а теперь может получить undefined — и TypeError вылетел
    // бы ВНЕ try/catch ниже: вебхук ответил бы 500, Meta ушла бы в ретраи, и
    // сообщение потерялось бы вместе со всеми последующими в этой доставке.
    if (!message.from) {
      const bsuid = message.from_user_id ?? value?.contacts?.[0]?.user_id ?? "неизвестен";
      this.logger.error(
        `Входящее без номера телефона: BSUID ${bsuid}, тип ${message.type}. ` +
          `Ответить нечем — нужен шаблон с кнопкой REQUEST_CONTACT_INFO.`,
      );
      return { ok: true };
    }

    const phone = chatIdToPhone(message.from);
    const chatId = `${message.from}@c.us`;
    await this.recordInbound(phone, message);

    // Реклама Click-to-WhatsApp. Приходит ровно один раз — в первом сообщении
    // после клика; дальше человек пишет как обычно, и связь с объявлением
    // теряется. Дальше по цепочке referral кладётся на сессию (см.
    // WhatsAppRouterService), потому что заявка заводится позже.
    const referral = message.referral
      ? {
          sourceType: message.referral.source_type,
          sourceId: message.referral.source_id,
          sourceUrl: message.referral.source_url,
          headline: message.referral.headline,
          ctwaClid: message.referral.ctwa_clid,
        }
      : undefined;
    if (referral) {
      this.logger.log(`Переход из рекламы: ${referral.sourceType ?? "?"} ${referral.sourceId ?? "?"} — ${phone}`);
    }

    try {
      if (message.type === "text") {
        await this.router.handleIncoming({ chatId, phone, referral, text: message.text?.body });
      } else if (message.type === "button") {
        // Нажатие quick-reply в ШАБЛОНЕ приходит именно так: type "button" и
        // payload, а не interactive.button_reply — тот бывает только у
        // интерактивных сообщений, то есть внутри открытого 24-часового окна.
        // Первое касание с клиентом или холодным поставщиком всегда идёт
        // шаблоном, поэтому без этой ветки были мертвы все кнопки: и
        // «Подтвердить» под заявкой, и «Интересно, беру» в приглашении.
        // Нажатие доходило до вебхука и молча выбрасывалось.
        await this.router.handleIncoming({ chatId, phone, referral, buttonReplyId: message.button?.payload });
      } else if (message.type === "interactive" && message.interactive?.type === "button_reply") {
        await this.router.handleIncoming({
          chatId,
          phone,
          referral,
          buttonReplyId: message.interactive.button_reply?.id,
        });
      } else if (message.type === "image") {
        // Cloud API gives an opaque media id, not a URL — CloudApiProvider's
        // downloadMedia() knows to resolve this id via the Graph API instead.
        await this.router.handleIncoming({ chatId, phone, referral, imageUrl: message.image?.id });
      } else {
        // Голосовое, документ, видео. Молчать нельзя: человек видит, что
        // сообщение доставлено, и ждёт ответа — в живой переписке это
        // выглядит как «меня игнорируют». Одной строки достаточно, и
        // replyUnsupportedType сам следит, чтобы она не повторялась.
        this.logger.warn(`Необработанный тип входящего сообщения: ${message.type}`);
        await this.router.replyUnsupportedType(phone, String(message.type ?? "unknown"));
      }
    } catch (err) {
      this.logger.error(`cloud webhook handling failed: ${(err as Error).message}`);
    }

    return { ok: true };
  }

  /**
   * Подпись Meta: HMAC-SHA256 от сырого тела на App Secret, заголовок
   * X-Hub-Signature-256 в виде "sha256=<hex>".
   *
   * Сравнение через timingSafeEqual, а не ===: обычное сравнение строк
   * останавливается на первом несовпавшем символе, и по времени ответа
   * подпись подбирается побайтно.
   *
   * Пустой секрет = проверка выключена (см. env.whatsappCloudAppSecret).
   * Предупреждение пишется на каждый запрос намеренно: это временное
   * состояние, и молчаливый лог позволил бы ему остаться навсегда.
   */
  private verifyMetaSignature(rawBody: Buffer | undefined, signature?: string): boolean {
    if (!env.whatsappCloudAppSecret) {
      this.logger.warn("WHATSAPP_CLOUD_APP_SECRET не задан — подпись вебхука не проверяется");
      return true;
    }
    if (!rawBody || !signature?.startsWith("sha256=")) return false;

    const expected = createHmac("sha256", env.whatsappCloudAppSecret).update(rawBody).digest();
    const got = Buffer.from(signature.slice("sha256=".length), "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  }
}
