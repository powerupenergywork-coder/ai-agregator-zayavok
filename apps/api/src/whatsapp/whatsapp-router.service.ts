import { Inject, Injectable, Logger } from "@nestjs/common";
import { detectLanguage, Language } from "@ai-zayavki/shared";
import { PrismaService } from "../prisma/prisma.service";
import { toLang } from "../common/language.util";
import { normalizePhone } from "../common/phone.util";
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
// Explicit language-override phrases — same exact-match idiom as the
// supplier-onboarding trigger phrases below, checked before auto-detection.
const RU_TRIGGER_PHRASES = new Set(["по-русски", "на русском", "русский"]);
const KK_TRIGGER_PHRASES = new Set(["қазақша", "қазақ тілінде", "қазақша сөйлесейік"]);

@Injectable()
export class WhatsAppRouterService {
  private readonly logger = new Logger(WhatsAppRouterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly authOtp: AuthOtpService,
    private readonly sessions: WhatsAppSessionService,
    private readonly onboarding: WhatsAppOnboardingService,
    private readonly billing: BillingService,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
  ) {}

  async handleIncoming(msg: IncomingWhatsAppMessage): Promise<void> {
    const lang = await this.resolveLanguage(msg.phone, msg.text);
    try {
      // Reply to a completion check-in — may arrive long after the drafting
      // conversation ended, so handle it standalone regardless of session.flow.
      if (msg.buttonReplyId?.startsWith("complete|")) {
        await this.handleCompletionReply(msg.phone, msg.buttonReplyId, lang);
        return;
      }

      if (msg.buttonReplyId === "billing|subscribe") {
        await this.handleSubscribeRequest(msg.phone, lang);
        return;
      }

      // Reply to the web flow's publish-confirmation request — same
      // standalone handling as complete| above, since it can arrive with no
      // active session (the order was drafted entirely on the web).
      if (msg.buttonReplyId?.startsWith("confirm_publish|")) {
        await this.handleConfirmPublish(msg.phone, msg.buttonReplyId, lang);
        return;
      }

      if (msg.text && BALANCE_TRIGGER_PHRASES.has(msg.text.trim().toLowerCase())) {
        await this.handleBalanceCommand(msg.phone, lang);
        return;
      }

      const session = await this.sessions.findOrCreate(msg.chatId, msg.phone);

      if (session.flow === "supplier_onboarding") {
        await this.onboarding.handleIncoming(msg.chatId, msg.phone, msg, lang);
        return;
      }

      if (msg.text && isOnboardingTrigger(msg.text)) {
        await this.onboarding.start(msg.chatId, msg.phone, lang);
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
        await this.handleToken(msg.chatId, msg.phone, token, lang);
      } else if (msg.imageUrl) {
        await this.handlePhoto(msg.chatId, msg.phone, msg.imageUrl, lang);
      } else if (msg.text) {
        await this.handleText(msg.chatId, msg.phone, msg.text, lang);
      }
    } catch (err) {
      this.logger.error(`Failed to handle WhatsApp message from ${msg.phone}: ${(err as Error).message}`);
      await this.whatsapp.sendText(
        msg.phone,
        lang === "kk" ? "Бір қате кетті, сәлден соң қайталап көріңіз." : "Что-то пошло не так, попробуйте ещё раз чуть позже.",
      );
    }
  }

  /** Auto-detects Kazakh from unique letters in the message text (no
   * blocking language-picker menu — see packages/shared/src/language.ts),
   * self-correcting on every incoming message; explicit trigger phrases
   * override it either way. Persists to User.preferredLanguage so WhatsApp
   * and web stay consistent for the same phone number.
   *
   * Also stamps lastInboundWhatsAppAt on every call — this is the single
   * choke point every real inbound webhook passes through (see
   * WhatsAppController), so it doubles as "when did this phone last message
   * us" for NotificationsService's 24h-window check before deciding
   * free text vs. a pre-approved template message. */
  private async resolveLanguage(phone: string, text: string | undefined): Promise<Language> {
    const normalized = normalizePhone(phone);
    const trimmed = text?.trim().toLowerCase();
    const override: Language | null = trimmed && RU_TRIGGER_PHRASES.has(trimmed)
      ? "ru"
      : trimmed && KK_TRIGGER_PHRASES.has(trimmed)
        ? "kk"
        : null;
    const resolved = override ?? (text ? detectLanguage(text) : null);
    const now = new Date();

    const user = await this.prisma.user.upsert({
      where: { phone: normalized },
      create: { phone: normalized, preferredLanguage: resolved === "kk" ? "KK" : "RU", lastInboundWhatsAppAt: now },
      update: { lastInboundWhatsAppAt: now, ...(resolved ? { preferredLanguage: resolved === "kk" ? "KK" : "RU" } : {}) },
    });
    return toLang(user.preferredLanguage);
  }

  private async handleCompletionReply(phone: string, token: string, lang: Language): Promise<void> {
    const [, result, orderId] = token.split("|");
    const authUser = await this.authOtp.getOrCreateClientAuthUser(phone);
    try {
      await this.orders.completeOrder(orderId, authUser, result === "yes");
      await this.whatsapp.sendText(
        phone,
        result === "yes"
          ? lang === "kk"
            ? "Керемет, рахмет! Өтінім жабылды."
            : "Отлично, спасибо! Заявка закрыта."
          : lang === "kk"
            ? "Түсінікті, операторға беремін — жақында хабарласамыз."
            : "Понял, передаю оператору — скоро свяжемся.",
      );
    } catch (err) {
      await this.whatsapp.sendText(phone, (err as Error).message);
    }
  }

  private async handleConfirmPublish(phone: string, token: string, lang: Language): Promise<void> {
    const [, orderId] = token.split("|");
    try {
      await this.orders.confirmPublish(orderId, phone);
      await this.whatsapp.sendText(
        phone,
        lang === "kk" ? "Өтінім жарияланды, орындаушыларды іздей бастадық." : "Заявка опубликована, начали искать исполнителей.",
      );
    } catch (err) {
      await this.whatsapp.sendText(phone, (err as Error).message);
    }
  }

  private async handleBalanceCommand(phone: string, lang: Language): Promise<void> {
    const authUser = await this.authOtp.getOrCreateSupplierAuthUser(phone);
    const status = await this.billing.getStatus(authUser.profileId);
    const lines =
      lang === "kk"
        ? [
            `Осы айда тегін өтінімдер: ${status.remainingFree} / ${status.freeQuota}`,
            status.subscriptionActive
              ? `Жазылым ${new Date(status.subscriptionExpiresAt!).toLocaleDateString("kk-KZ")} дейін белсенді`
              : `Жазылым рәсімделмеген — шексіз үшін ${status.periodDays} күнге ${status.priceTenge} ₸`,
          ]
        : [
            `Бесплатных заявок в этом месяце: ${status.remainingFree} из ${status.freeQuota}`,
            status.subscriptionActive
              ? `Подписка активна до ${new Date(status.subscriptionExpiresAt!).toLocaleDateString("ru-RU")}`
              : `Подписка не оформлена — ${status.priceTenge} ₸ за ${status.periodDays} дней безлимита`,
          ];
    const body = lines.join("\n");
    if (status.subscriptionActive) {
      await this.whatsapp.sendText(phone, body);
    } else {
      await this.whatsapp.sendButtons(phone, body, [
        { id: "billing|subscribe", text: lang === "kk" ? "Жазылу рәсімдеу" : "Оформить подписку" },
      ]);
    }
  }

  private async handleSubscribeRequest(phone: string, lang: Language): Promise<void> {
    const authUser = await this.authOtp.getOrCreateSupplierAuthUser(phone);
    const { paymentUrl } = await this.billing.requestSubscription(authUser.profileId);
    await this.whatsapp.sendText(phone, `${lang === "kk" ? "Жазылымға төлем" : "Оплата подписки"}: ${paymentUrl}`);
  }

  private async handleToken(chatId: string, phone: string, token: string, lang: Language): Promise<void> {
    const [kind, ...rest] = token.split("|");

    if (kind === "cat") {
      const orderId = await this.ensureOrder(chatId, phone);
      await this.sendTurn(chatId, phone, await this.orders.pickCategory(orderId, rest[0], lang), lang);
      return;
    }

    if (kind === "fld") {
      const [key, rawValue] = rest;
      const orderId = await this.ensureOrder(chatId, phone);
      await this.sendTurn(chatId, phone, await this.orders.setField(orderId, key, coerceValue(rawValue), lang), lang);
      return;
    }

    if (kind === "action" && rest[0] === "publish") {
      await this.publishCurrentOrder(chatId, phone, lang);
      return;
    }

    if (kind === "action" && rest[0] === "edit") {
      await this.whatsapp.sendText(
        phone,
        lang === "kk"
          ? 'Не өзгерту керектігін жазыңыз, мысалы: "салмағы 5 тонна" немесе "мекенжай Абай 10".'
          : 'Напишите, что изменить, например: "вес 5 тонн" или "адрес Абая 10".',
      );
    }
  }

  private async handleText(chatId: string, phone: string, text: string, lang: Language): Promise<void> {
    const session = await this.sessions.findOrCreate(chatId, phone);

    if (session.currentOrderId) {
      const order = await this.orders.getRawOrThrow(session.currentOrderId);
      if (!DRAFT_STATUSES.includes(order.status)) {
        if (/нов(ая|ый)\s*(заявк|заказ)/i.test(text) || /жаңа\s*өтінім/i.test(text)) {
          await this.sessions.clearOrder(chatId);
          await this.whatsapp.sendText(phone, lang === "kk" ? "Жарайды, жаңа өтінімнен бастайық. Не керек?" : "Хорошо, начнём новую заявку. Что вам нужно?");
        } else {
          const dto = await this.orders.toDto(session.currentOrderId);
          if (dto.status === "PUBLISHED") {
            // Any message on an active order is a chance to close the loop —
            // the client may just be checking in, not tapping the original
            // check-in buttons (which could be days old by now).
            const body =
              lang === "kk"
                ? `Өтінім №${dto.number}: ${dto.statusLabel.kk}. Қызмет көрсетілді ме?`
                : `Заявка №${dto.number}: ${dto.statusLabel.ru}. Услугу уже оказали?`;
            await this.whatsapp.sendButtons(phone, body, [
              { id: `complete|yes|${session.currentOrderId}`, text: lang === "kk" ? "Иә, бәрі жақсы" : "Да, всё хорошо" },
              { id: `complete|no|${session.currentOrderId}`, text: lang === "kk" ? "Жоқ, болмады" : "Нет, не получилось" },
            ]);
          } else {
            await this.whatsapp.sendText(
              phone,
              lang === "kk" ? `Өтінім №${dto.number}: ${dto.statusLabel.kk}.` : `Заявка №${dto.number}: ${dto.statusLabel.ru}.`,
            );
          }
        }
        return;
      }
    }

    const orderId = await this.ensureOrder(chatId, phone);
    await this.sendTurn(chatId, phone, await this.orders.chat(orderId, text, lang), lang);
  }

  private async handlePhoto(chatId: string, phone: string, imageUrl: string, lang: Language): Promise<void> {
    const orderId = await this.ensureOrder(chatId, phone);
    const buffer = await this.whatsapp.downloadMedia(imageUrl);
    await this.orders.addPhoto(orderId, buffer, `whatsapp-${Date.now()}.jpg`, "image/jpeg");
    await this.whatsapp.sendText(phone, lang === "kk" ? "Фото өтінімге қосылды." : "Фото добавлено к заявке.");
  }

  private async publishCurrentOrder(chatId: string, phone: string, lang: Language): Promise<void> {
    const session = await this.sessions.findOrCreate(chatId, phone);
    if (!session.currentOrderId) {
      await this.whatsapp.sendText(phone, lang === "kk" ? "Алдымен не керектігін жазыңыз." : "Сначала опишите, что вам нужно.");
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
      await this.whatsapp.sendText(
        phone,
        `${lang === "kk" ? "Өтінімді жариялау мүмкін болмады" : "Не получилось опубликовать заявку"}: ${(err as Error).message}`,
      );
    }
  }

  private async ensureOrder(chatId: string, phone: string): Promise<string> {
    const session = await this.sessions.findOrCreate(chatId, phone);
    if (session.currentOrderId) return session.currentOrderId;
    const draft = await this.orders.createDraft();
    await this.sessions.setCurrentOrder(chatId, draft.id);
    return draft.id;
  }

  private async sendTurn(chatId: string, phone: string, turn: ChatTurnResponse, lang: Language): Promise<void> {
    let rendered: OutgoingWhatsAppMessage;
    if (turn.needsCategoryPick) {
      rendered = renderCategoryPick(turn.categories ?? [], lang);
    } else if (turn.isReadyForReview) {
      rendered = renderReviewCard(turn.order, lang);
    } else if (turn.nextFields.length > 0) {
      rendered = renderFieldQuestion(turn.nextFields, turn.assistantMessage, lang);
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
