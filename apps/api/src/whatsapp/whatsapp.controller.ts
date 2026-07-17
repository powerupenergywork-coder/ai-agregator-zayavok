import { Body, Controller, HttpCode, Logger, Post, UnauthorizedException, Headers } from "@nestjs/common";
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
}
