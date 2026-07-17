import { Inject, Injectable, Logger } from "@nestjs/common";
import { OrdersService, ChatTurnResponse } from "../orders/orders.service";
import { BillingService } from "../billing/billing.service";
import { AuthOtpService } from "../auth-otp/auth-otp.service";
import { WHATSAPP_PROVIDER, WhatsAppProvider } from "./whatsapp-provider.interface";
import { WhatsAppSessionService } from "./whatsapp-session.service";
import { WhatsAppOnboardingService, isOnboardingTrigger } from "./whatsapp-onboarding.service";
import { IncomingWhatsAppMessage } from "./whatsapp.types";
import {
  OutgoingWhatsAppMessage,
  renderCategoryPick,
  renderFieldQuestion,
  renderReviewCard,
} from "./whatsapp-message-render.util";

export { IncomingWhatsAppMessage } from "./whatsapp.types";

const DRAFT_STATUSES = ["DRAFT", "CLARIFYING"];
const BALANCE_TRIGGER_PHRASES = new Set(["баланс", "мой баланс", "подписка"]);

@Injectable()
export class WhatsAppRouterService {
  private readonly logger = new Logger(WhatsAppRouterService.name);

  constructor(
    private readonly orders: OrdersService,
    private readonly authOtp: AuthOtpService,
    private readonly sessions: WhatsAppSessionService,
    private readonly onboarding: WhatsAppOnboardingService,
    private readonly billing: BillingService,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
  ) {}

  async handleIncoming(msg: IncomingWhatsAppMessage): Promise<void> {
    try {
      // Reply to a completion check-in — may arrive long after the drafting
      // conversation ended, so handle it standalone regardless of session.flow.
      if (msg.buttonReplyId?.startsWith("complete|")) {
        await this.handleCompletionReply(msg.phone, msg.buttonReplyId);
        return;
      }

      if (msg.buttonReplyId === "billing|subscribe") {
        await this.handleSubscribeRequest(msg.phone);
        return;
      }

      if (msg.text && BALANCE_TRIGGER_PHRASES.has(msg.text.trim().toLowerCase())) {
        await this.handleBalanceCommand(msg.phone);
        return;
      }

      const session = await this.sessions.findOrCreate(msg.chatId, msg.phone);

      if (session.flow === "supplier_onboarding") {
        await this.onboarding.handleIncoming(msg.chatId, msg.phone, msg);
        return;
      }

      if (msg.text && isOnboardingTrigger(msg.text)) {
        await this.onboarding.start(msg.chatId, msg.phone);
        return;
      }

      // A tapped button always wins; otherwise a bare number typed against the
      // last numbered list we sent resolves to the same token — see
      // whatsapp-message-render.util.ts for the "cat|/fld|/action|" encoding.
      let token = msg.buttonReplyId;
      if (!token && msg.text && /^\d+$/.test(msg.text.trim())) {
        const pending = (session.stateData as { pendingOptions?: Record<string, string> } | null)?.pendingOptions;
        token = pending?.[msg.text.trim()];
      }

      if (token) {
        await this.handleToken(msg.chatId, msg.phone, token);
      } else if (msg.imageUrl) {
        await this.handlePhoto(msg.chatId, msg.phone, msg.imageUrl);
      } else if (msg.text) {
        await this.handleText(msg.chatId, msg.phone, msg.text);
      }
    } catch (err) {
      this.logger.error(`Failed to handle WhatsApp message from ${msg.phone}: ${(err as Error).message}`);
      await this.whatsapp.sendText(msg.phone, "Что-то пошло не так, попробуйте ещё раз чуть позже.");
    }
  }

  private async handleCompletionReply(phone: string, token: string): Promise<void> {
    const [, result, orderId] = token.split("|");
    const authUser = await this.authOtp.getOrCreateClientAuthUser(phone);
    try {
      await this.orders.completeOrder(orderId, authUser, result === "yes");
      await this.whatsapp.sendText(
        phone,
        result === "yes" ? "Отлично, спасибо! Заявка закрыта." : "Понял, передаю оператору — скоро свяжемся.",
      );
    } catch (err) {
      await this.whatsapp.sendText(phone, (err as Error).message);
    }
  }

  private async handleBalanceCommand(phone: string): Promise<void> {
    const authUser = await this.authOtp.getOrCreateSupplierAuthUser(phone);
    const status = await this.billing.getStatus(authUser.profileId);
    const lines = [
      `Бесплатных заявок в этом месяце: ${status.remainingFree} из ${status.freeQuota}`,
      status.subscriptionActive
        ? `Подписка активна до ${new Date(status.subscriptionExpiresAt!).toLocaleDateString("ru-RU")}`
        : `Подписка не оформлена — ${status.priceTenge} ₸ за ${status.periodDays} дней безлимита`,
    ];
    const body = lines.join("\n");
    if (status.subscriptionActive) {
      await this.whatsapp.sendText(phone, body);
    } else {
      await this.whatsapp.sendButtons(phone, body, [{ id: "billing|subscribe", text: "Оформить подписку" }]);
    }
  }

  private async handleSubscribeRequest(phone: string): Promise<void> {
    const authUser = await this.authOtp.getOrCreateSupplierAuthUser(phone);
    const { paymentUrl } = await this.billing.requestSubscription(authUser.profileId);
    await this.whatsapp.sendText(phone, `Оплата подписки: ${paymentUrl}`);
  }

  private async handleToken(chatId: string, phone: string, token: string): Promise<void> {
    const [kind, ...rest] = token.split("|");

    if (kind === "cat") {
      const orderId = await this.ensureOrder(chatId, phone);
      await this.sendTurn(chatId, phone, await this.orders.pickCategory(orderId, rest[0]));
      return;
    }

    if (kind === "fld") {
      const [key, rawValue] = rest;
      const orderId = await this.ensureOrder(chatId, phone);
      await this.sendTurn(chatId, phone, await this.orders.setField(orderId, key, coerceValue(rawValue)));
      return;
    }

    if (kind === "action" && rest[0] === "publish") {
      await this.publishCurrentOrder(chatId, phone);
      return;
    }

    if (kind === "action" && rest[0] === "edit") {
      await this.whatsapp.sendText(phone, 'Напишите, что изменить, например: "вес 5 тонн" или "адрес Абая 10".');
    }
  }

  private async handleText(chatId: string, phone: string, text: string): Promise<void> {
    const session = await this.sessions.findOrCreate(chatId, phone);

    if (session.currentOrderId) {
      const order = await this.orders.getRawOrThrow(session.currentOrderId);
      if (!DRAFT_STATUSES.includes(order.status)) {
        if (/нов(ая|ый)\s*(заявк|заказ)/i.test(text)) {
          await this.sessions.clearOrder(chatId);
          await this.whatsapp.sendText(phone, "Хорошо, начнём новую заявку. Что вам нужно?");
        } else {
          const dto = await this.orders.toDto(session.currentOrderId);
          if (dto.status === "PUBLISHED") {
            // Any message on an active order is a chance to close the loop —
            // the client may just be checking in, not tapping the original
            // check-in buttons (which could be days old by now).
            await this.whatsapp.sendButtons(phone, `Заявка №${dto.number}: ${dto.statusLabel}. Услугу уже оказали?`, [
              { id: `complete|yes|${session.currentOrderId}`, text: "Да, всё хорошо" },
              { id: `complete|no|${session.currentOrderId}`, text: "Нет, не получилось" },
            ]);
          } else {
            await this.whatsapp.sendText(phone, `Заявка №${dto.number}: ${dto.statusLabel}.`);
          }
        }
        return;
      }
    }

    const orderId = await this.ensureOrder(chatId, phone);
    await this.sendTurn(chatId, phone, await this.orders.chat(orderId, text));
  }

  private async handlePhoto(chatId: string, phone: string, imageUrl: string): Promise<void> {
    const orderId = await this.ensureOrder(chatId, phone);
    const buffer = await this.whatsapp.downloadMedia(imageUrl);
    await this.orders.addPhoto(orderId, buffer, `whatsapp-${Date.now()}.jpg`, "image/jpeg");
    await this.whatsapp.sendText(phone, "Фото добавлено к заявке.");
  }

  private async publishCurrentOrder(chatId: string, phone: string): Promise<void> {
    const session = await this.sessions.findOrCreate(chatId, phone);
    if (!session.currentOrderId) {
      await this.whatsapp.sendText(phone, "Сначала опишите, что вам нужно.");
      return;
    }
    const authUser = await this.authOtp.getOrCreateClientAuthUser(phone);
    try {
      // OrdersService.publish() already sends the "order_published" notification
      // through NotificationsService, which now routes to WhatsApp on its own
      // (User.preferredChannel was just set to WHATSAPP above) — no need to send
      // a second confirmation here.
      await this.orders.publish(session.currentOrderId, authUser);
      await this.sessions.setPendingOptions(chatId, undefined);
    } catch (err) {
      await this.whatsapp.sendText(phone, `Не получилось опубликовать заявку: ${(err as Error).message}`);
    }
  }

  private async ensureOrder(chatId: string, phone: string): Promise<string> {
    const session = await this.sessions.findOrCreate(chatId, phone);
    if (session.currentOrderId) return session.currentOrderId;
    const draft = await this.orders.createDraft();
    await this.sessions.setCurrentOrder(chatId, draft.id);
    return draft.id;
  }

  private async sendTurn(chatId: string, phone: string, turn: ChatTurnResponse): Promise<void> {
    let rendered: OutgoingWhatsAppMessage;
    if (turn.needsCategoryPick) {
      rendered = renderCategoryPick(turn.categories ?? []);
    } else if (turn.isReadyForReview) {
      rendered = renderReviewCard(turn.order);
    } else if (turn.nextFields.length > 0) {
      rendered = renderFieldQuestion(turn.nextFields, turn.assistantMessage);
    } else {
      rendered = { body: turn.assistantMessage };
    }

    await this.sessions.setPendingOptions(chatId, rendered.pendingOptions);
    if (rendered.buttons) {
      await this.whatsapp.sendButtons(phone, rendered.body, rendered.buttons);
    } else {
      await this.whatsapp.sendText(phone, rendered.body);
    }
  }
}

function coerceValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}
