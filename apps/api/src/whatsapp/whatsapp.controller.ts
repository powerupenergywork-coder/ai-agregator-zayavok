import { Body, Controller, Get, HttpCode, Logger, Post, Query, Res, UnauthorizedException, Headers } from "@nestjs/common";
import type { Response } from "express";
import { env } from "../config/env";
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

  constructor(private readonly router: WhatsAppRouterService) {}

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
   * read/failed) to this one URL — we only act on inbound messages and 200
   * everything else so Meta stops retrying.
   */
  @Post("cloud-webhook")
  @HttpCode(200)
  async cloudWebhook(@Body() body: any): Promise<{ ok: true }> {
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    if (!message) {
      // No inbound message (e.g. a status callback) — nothing to route.
      return { ok: true };
    }

    const phone = chatIdToPhone(message.from);
    const chatId = `${message.from}@c.us`;

    try {
      if (message.type === "text") {
        await this.router.handleIncoming({ chatId, phone, text: message.text?.body });
      } else if (message.type === "interactive" && message.interactive?.type === "button_reply") {
        await this.router.handleIncoming({ chatId, phone, buttonReplyId: message.interactive.button_reply?.id });
      } else if (message.type === "image") {
        // Cloud API gives an opaque media id, not a URL — CloudApiProvider's
        // downloadMedia() knows to resolve this id via the Graph API instead.
        await this.router.handleIncoming({ chatId, phone, imageUrl: message.image?.id });
      }
    } catch (err) {
      this.logger.error(`cloud webhook handling failed: ${(err as Error).message}`);
    }

    return { ok: true };
  }
}
