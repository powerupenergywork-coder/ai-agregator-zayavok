import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  CITIES,
  detectLanguage,
  findCitiesInText,
  Language,
  LocalizedText,
  looksLikeQuestion,
} from "@ai-zayavki/shared";
import { PrismaService } from "../prisma/prisma.service";
import { toLang } from "../common/language.util";
import { normalizePhone } from "../common/phone.util";
import { env, kaspiBillerActive, kaspiPayUrl, paymentsEnabled } from "../config/env";
import { OrdersService, ChatTurnResponse } from "../orders/orders.service";
import { BillingService } from "../billing/billing.service";
import { AuthOtpService } from "../auth-otp/auth-otp.service";
import { WHATSAPP_PROVIDER, WhatsAppProvider } from "./whatsapp-provider.interface";
import { WhatsAppSessionService } from "./whatsapp-session.service";
import { WhatsAppOnboardingService, isOnboardingTrigger } from "./whatsapp-onboarding.service";
import { ProspectService } from "../prospect/prospect.service";
import { MatchingService } from "../matching/matching.service";
import { IncomingWhatsAppMessage } from "./whatsapp.types";
import {
  OutgoingWhatsAppMessage,
  renderCategoryPick,
  renderFieldQuestion,
  renderReviewCard,
} from "./whatsapp-message-render.util";

export { IncomingWhatsAppMessage } from "./whatsapp.types";

const DRAFT_STATUSES = ["DRAFT", "CLARIFYING"];
// Nothing further will happen to an order in one of these — including
// NEEDS_OPERATOR, which now only means "no supplier matched" and has no
// operator queue behind it. See handleText().
const FINISHED_STATUSES = ["COMPLETED", "CANCELLED_BY_CLIENT", "CANCELLED_BY_ADMIN", "NEEDS_OPERATOR"];
const BALANCE_TRIGGER_PHRASES = new Set(["баланс", "мой баланс", "подписка"]);
// A supplier who can't stop the messages reports them as spam instead, and
// spam reports cost the number's quality rating — so opting out has to work
// on a plain word, at any moment, without a menu to find first.
const STOP_TRIGGER_PHRASES = new Set([
  "стоп", "стоп рассылка", "отписаться", "не писать", "не присылать", "отключить рассылку",
  "тоқта", "жазылымнан бас тарту", "жазбаңыз",
]);
const RESUME_TRIGGER_PHRASES = new Set([
  "возобновить", "включить рассылку", "старт", "продолжить",
  "жалғастыру", "қосу",
]);
const PROFILE_TRIGGER_PHRASES = new Set([
  "профиль", "мой профиль", "помощь", "меню", "команды",
  "профиль көрсету", "көмек", "мәзір",
]);
// An explicit way out of the supplier help reply and into ordering something
// for yourself — a supplier is also a person who occasionally needs a truck.
const NEW_ORDER_PHRASES = /нов(ая|ый)\s*(заявк|заказ)|жаңа\s*өтінім/i;

/** Через сколько часов простоя черновик перестаёт считаться «текущим
 * разговором» и отцепляется от чата — см. releaseStaleOrder(). */
const STALE_DRAFT_HOURS = 6;
/** Страница с условиями для исполнителей. Единственное место, где человек
 *  может проверить нас, не спрашивая: в холодном приглашении ссылки нет —
 *  его текст утверждён у Меты и заморожен. */
function suppliersPageUrl(): string {
  return `${env.webUrl}/dlya-ispolniteley`;
}
/** Взял заявку. «Вроде договорились… озвонится» — тоже сюда. */
const AGREED_RE =
  /договорил|догов[оа]рюсь|созвон|беру|взял|возьму|еду|выехал|выезжа|работаю|сделаю|принял|согласовал|буду делать|келісті|аламын/i;
/** Не берётся. Отдельный исход, а не молчание: заявку можно предложить дальше. */
const DECLINED_RE =
  /не\s*(смогу|получится|буду|беру|возьму|подход|могу)|отказ|занят|далеко|нет\s*(машины|техники|времени)|бос емес|алмаймын/i;
/**
 * Разговор про работу вообще, а не про конкретную заявку. Два вида, ответ
 * один: «есть ещё заказы?» (спрашивает сейчас) и «если будет — обращайтесь»
 * (предлагает себя на будущее).
 *
 * Второй вид вежливый и потому обманчивый: он не выглядит вопросом, и раньше
 * «если будет заявка, заказ обращайтесь» попадало в описание техники — в
 * профиле у человека так и осталась эта строка рядом с «услуги манипулятора».
 */
const MORE_ORDERS_RE =
  /есть\s*(ещ[её]|еще)?\s*(заказ|заявк|работ)|нужн[ыа]\s*заказ|дайте\s*(заказ|заявк)|тапсырыс бар ма|(если|когда|как)\s*(будет|будут|появ|поступ)|обращайтесь|обращайся|зовите|звоните|пишите|хабарласыңыз|болса айтыңыз/i;
/**
 * Приветствие. По префиксу, а не по точному совпадению: реальные люди пишут
 * «Здраствуйте» без «в», «Салеметсізбе» одним словом, «Сәлеметсіз бе» двумя.
 * Список точных форм такое не ловит, а именно с приветствия начинается
 * половина первых контактов.
 */
const GREETING_RE =
  /^\s*(здравств|здраств|привет|добр(ый|ое)\s|сал[аеә]м|сәлем|салеметс|сәлеметс|ассал|assal|қайырлы)/i;
/**
 * «Я не клиент, у меня услуги». Человек прямым текстом говорит, что он
 * исполнитель, а не заказчик — и это надо услышать в любой момент, даже
 * посреди заполнения заявки.
 */
const NOT_A_CLIENT_RE =
  /я\s*не\s*(клиент|заказчик)|не\s*клиент|я\s*(поставщик|исполнитель|подрядчик)|у\s*меня\s*(есть\s*)?(услуг|техник|машин|кран|манипулятор|самосвал|газель)|оказыва[юе]\s*услуг|предлага[юе]\s*услуг|услуги\s*(манипулятора|крана|самосвала|газели)|мен\s*жеткізушімін|қызмет\s*көрсетемін|(манипулятор|кран|самосвал|газель|техника)\s*қызмет/i;
/** Ищет услугу, а не предлагает: отличает клиента от исполнителя в тех же словах. */
const NEED_RE = /нужн|нужен|ищу|требу|надо|хочу\s*(заказ|нанять)|закаж|аренд|керек|іздеп/i;
function looksLikeSupplierDeclaration(text: string): boolean {
  return NOT_A_CLIENT_RE.test(text) && !NEED_RE.test(text);
}
/**
 * Ищет работу. Отдельно от NOT_A_CLIENT_RE, потому что это не заявление
 * «я исполнитель», а вопрос — и отвечать на него надо вопросом, а не
 * переключением потока.
 *
 * Реальный случай: «Тут можно работу найти или че ?». Ни одно из слов не
 * попадало в NOT_A_CLIENT_RE, человек получил список категорий, выбрал
 * «Самосвал» и полтора часа спустя — вопрос «в каком городе нужна услуга?».
 * То есть водитель самосвала оформлял заказ самосвала самому себе.
 *
 * «Есть работа» намеренно НЕ ловим: так говорит и заказчик, предлагающий
 * работу исполнителям. Ловим только формулировки, где человек ищет работу
 * себе.
 */
const WORK_SEEKER_RE =
  /(ищу|найти|найд[ёе]м|хочу|где)\s+работ|работ[ауы]\s+(найти|ищу|есть\s*ли)|подработк|трудоустрой|ваканси|жұмыс\s+(іздеп|табу|бар\s*ма)/i;
// Подтверждение прочтения: ответа не требует. Держим отдельно от вежливости —
// на «спасибо» после разговора уместно промолчать так же, но причина другая.
const ACK_RE = /^[\s\p{Extended_Pictographic}‍️]+$/u;
function isAcknowledgement(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (ACK_RE.test(text)) return true;
  return ["спасибо", "спс", "рахмет", "ок", "окей", "хорошо", "принял", "понял", "жарайды"].includes(t);
}
// «Спасибо», «ок», «здравствуйте» — не рассказ о себе, и записывать это в
// профиль как характеристику техники было бы враньём.
const PLEASANTRIES = new Set([
  "спасибо", "спс", "благодарю", "ок", "окей", "хорошо", "понятно", "принял", "ясно", "да", "нет",
  "здравствуйте", "привет", "добрый день", "добрый вечер", "доброе утро", "салам", "салем", "ассалаумагалейкум",
  "рахмет", "жарайды", "түсінікті", "сәлем", "сәлеметсіз бе", "иә", "жоқ",
]);
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
    private readonly prospect: ProspectService,
    private readonly matching: MatchingService,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
  ) {}

  async handleIncoming(msg: IncomingWhatsAppMessage): Promise<void> {
    const lang = await this.resolveLanguage(msg.phone, msg.text);

    // Источник запоминаем до разбора сообщения: любая ветка ниже может
    // ответить и выйти, а клик по рекламе Meta пришлёт ровно один раз.
    if (msg.referral) {
      try {
        await this.sessions.findOrCreate(msg.chatId, msg.phone);
        await this.sessions.recordAdReferral(msg.chatId, msg.referral);
      } catch (err) {
        // Атрибуция не стоит потерянного разговора.
        this.logger.warn(`Не удалось записать источник рекламы: ${(err as Error).message}`);
      }
    }

    try {
      // Reply to a completion check-in — may arrive long after the drafting
      // conversation ended, so handle it standalone regardless of session.flow.
      if (msg.buttonReplyId?.startsWith("complete|")) {
        await this.handleCompletionReply(msg.phone, msg.buttonReplyId, lang);
        return;
      }

      // Reply to a cold-invite (see MatchingService.dispatchToSupplier) —
      // handled standalone like the check-in above, since it arrives with no
      // drafting session of its own.
      if (msg.buttonReplyId?.startsWith("supconfirm|")) {
        await this.handleColdInviteReply(msg.phone, msg.buttonReplyId, lang);
        return;
      }

      // Ответ на «вы работаете и в Караганде?» — приходит без сессии, как и
      // остальные ответы поставщика.
      if (msg.buttonReplyId?.startsWith("supcity|")) {
        await this.handleCityOffer(msg.phone, msg.buttonReplyId, lang);
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

      // Checked before the session and the onboarding flow: someone trying to
      // stop the messages must not have to finish a dialogue first.
      if (msg.text) {
        const t = msg.text.trim().toLowerCase();
        if (STOP_TRIGGER_PHRASES.has(t)) {
          await this.setSupplierPaused(msg.phone, true, lang);
          return;
        }
        if (RESUME_TRIGGER_PHRASES.has(t)) {
          await this.setSupplierPaused(msg.phone, false, lang);
          return;
        }
        if (PROFILE_TRIGGER_PHRASES.has(t)) {
          await this.sendSupplierProfile(msg.phone, lang);
          return;
        }
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

      // «Я не клиент, у меня услуги манипулятора» — проверяем ДО разбора
      // заявки и независимо от того, есть ли активный черновик. Реальный
      // случай: человек написал это посреди оформления и получил тот же
      // вопрос про адрес ещё четыре раза, потому что проверка «не поставщик
      // ли это» стояла под условием «если заявки нет», а заявка уже была.
      if (msg.text && looksLikeSupplierDeclaration(msg.text)) {
        await this.switchToSupplier(msg.chatId, msg.phone, lang);
        return;
      }

      // «Тут можно работу найти?» — это вопрос, а не заявление, и переключать
      // поток по нему нельзя: тот же вопрос может задать заказчик, ищущий,
      // кому отдать работу. Поэтому спрашиваем, кто он, — двумя кнопками.
      //
      // Проверяется до разбора заявки и независимо от наличия черновика: у
      // человека из реального случая черновик уже был, и без этого условия
      // вопрос снова утонул бы в оформлении заказа.
      if (msg.text && WORK_SEEKER_RE.test(msg.text)) {
        await this.askWhoTheyAre(msg.phone, lang);
        return;
      }

      // Приветствие не должно заводить заявку. Незнакомец, написавший
      // «Здравствуйте», раньше получал список категорий и молча оказывался в
      // оформлении заказа — включая тех, кто пришёл предложить свои услуги.
      // Спрашиваем, кто он, вместо того чтобы решать за него.
      if (msg.text && !session.currentOrderId && GREETING_RE.test(msg.text)) {
        await this.askWhoTheyAre(msg.phone, lang);
        return;
      }

      if (msg.buttonReplyId?.startsWith("who|")) {
        await this.handleWhoAnswer(msg.chatId, msg.phone, msg.buttonReplyId, lang);
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
    // Приветствие язык не определяет. Реальный случай: человек написал
    // «Салеметсізбе», разговор целиком переехал на казахский, а следующие два
    // его сообщения были по-русски — но в русском тексте нет букв, по которым
    // язык распознаётся, поэтому настройка так и осталась казахской.
    // Самое неинформативное сообщение не должно решать за весь разговор.
    const informative = !!text && !GREETING_RE.test(text);
    const resolved = override ?? (informative ? detectLanguage(text!) : null);
    const now = new Date();

    const user = await this.prisma.user.upsert({
      where: { phone: normalized },
      create: { phone: normalized, preferredLanguage: resolved === "kk" ? "KK" : "RU", lastInboundWhatsAppAt: now },
      update: { lastInboundWhatsAppAt: now, ...(resolved ? { preferredLanguage: resolved === "kk" ? "KK" : "RU" } : {}) },
    });
    return toLang(user.preferredLanguage);
  }

  private async handleCompletionReply(phone: string, token: string, lang: Language): Promise<void> {
    const [, outcome, orderId] = token.split("|") as [string, "resolved" | "redispatch" | "closed", string];
    const authUser = await this.authOtp.getOrCreateClientAuthUser(phone);
    try {
      await this.orders.completeOrder(orderId, authUser, outcome);
      const replies: Record<"resolved" | "redispatch" | "closed", { ru: string; kk: string }> = {
        resolved: { ru: "Отлично, спасибо! Заявка закрыта.", kk: "Керемет, рахмет! Өтінім жабылды." },
        redispatch: { ru: "Хорошо, ищем других исполнителей для вас.", kk: "Жарайды, сізге басқа орындаушыларды іздейміз." },
        closed: { ru: "Хорошо, заявка закрыта.", kk: "Жарайды, өтінім жабылды." },
      };
      await this.whatsapp.sendText(phone, replies[outcome][lang]);
    } catch (err) {
      await this.whatsapp.sendText(phone, (err as Error).message);
    }
  }

  /** "Интересно, беру" / "Не писать мне" under a cold invite. This is the
   * opt-in gate: until it's tapped the supplier only ever saw a summary with
   * no client contact details. Declining blocks them outright — an explicit
   * "don't contact me" is worth honouring permanently, both for them and to
   * keep the number's quality rating clean. */
  private async handleColdInviteReply(phone: string, token: string, lang: Language): Promise<void> {
    const [, answer, orderId] = token.split("|");
    const supplier = await this.prisma.supplierProfile.findFirst({
      where: { user: { phone: normalizePhone(phone) } },
    });
    if (!supplier) return;

    try {
      if (answer === "yes") {
        const result = await this.matching.confirmColdSupplier(supplier.id, orderId);

        // Повторное нажатие той же кнопки — обычно потому, что в первый раз
        // человек не понял, сработало ли. Отвечаем так, чтобы было видно: да,
        // услышали, ничего делать больше не надо.
        if (result.alreadyConfirmed && result.outcome !== "order_sent") {
          await this.whatsapp.sendText(
            phone,
            lang === "kk"
              ? "Сіз қосылып қойғансыз. Жаңа өтінім шыққанда бірден жібереміз."
              : "Вы уже подключены. Как появится подходящая заявка — сразу пришлём.",
          );
          return;
        }

        // Заявку уже закрыли, пока он думал. Промолчать здесь — худшее из
        // возможного: человек нажал «беру», ждёт телефон клиента и не
        // понимает, почему ничего нет.
        if (result.outcome === "order_closed") {
          await this.whatsapp.sendText(
            phone,
            lang === "kk"
              ? "Өкінішке қарай, бұл өтінімді клиент жауып үлгерді.\n\n" +
                "Бірақ сіз қосылдыңыз — келесі сәйкес өтінімді бірден жібереміз.\n\n" +
                this.commandHints(lang)
              : "К сожалению, эту заявку клиент уже закрыл.\n\n" +
                "Но вы подключены — следующую подходящую пришлём сразу.\n\n" +
                this.commandHints(lang),
          );
          return;
        }

        // Заявка ушла отдельным сообщением (полное описание с телефоном
        // клиента), либо согласие пришло вне рассылки и заявки просто нет —
        // здесь только подсказки по командам. Это единственное место, где они
        // вообще упоминаются: текст шаблона рассылки заморожен при утверждении
        // в Мете и нести их не может.
        await this.whatsapp.sendText(
          phone,
          lang === "kk"
            ? "Тіркелдіңіз! Сәйкес өтінімдерді жібереміз.\n\n" + this.commandHints(lang)
            : "Готово! Будем присылать вам подходящие заявки.\n\n" + this.commandHints(lang),
        );
        return;
      }

      // «Что это такое?» — вопрос, а не ответ. Ничего не меняем в профиле:
      // человек ещё не решил. Кнопки исходного приглашения остаются живыми,
      // WhatsApp позволяет нажать их и после нашего ответа, поэтому звать
      // отдельно «напишите да» не нужно.
      //
      // Ветка обязана стоять ДО блокировки ниже: там всё, что не "yes",
      // считается отказом, и вопрос выключил бы человека навсегда.
      if (answer === "what") {
        await this.whatsapp.sendText(
          phone,
          lang === "kk"
            ? "KerekTap — Қазақстандағы қызмет көрсету өтінімдерінің сервисі.\n\n" +
              "Клиент чатта тапсырмасын жазады, біз оны сіздің қалаңызда жұмыс істейтін орындаушыларға жібереміз. " +
              "Аласыз ба — клиенттің телефонын жібереміз, тікелей келісесіз.\n\n" +
              "Тапсырыстан комиссия алмаймыз және мәмілеге араласпаймыз. " +
              `Айына алғашқы ${env.freeNotificationsPerMonth} өтінім тегін.\n\n` +
              "Толығырақ: " +
              suppliersPageUrl()
            : "KerekTap — сервис заявок на услуги в Казахстане.\n\n" +
              "Клиент описывает задачу в чате, мы передаём её исполнителям, которые работают в его городе. " +
              "Возьмётесь — пришлём телефон клиента, договоритесь напрямую.\n\n" +
              "Комиссию с заказа не берём и в сделку не вмешиваемся. " +
              `Первые ${env.freeNotificationsPerMonth} заявок в месяц бесплатно.\n\n` +
              "Подробнее: " +
              suppliersPageUrl(),
        );
        return;
      }

      await this.prisma.supplierProfile.update({
        where: { id: supplier.id },
        data: { isBlocked: true, activityStatus: "BLOCKED" },
      });
      await this.whatsapp.sendText(
        phone,
        lang === "kk" ? "Түсіндік, енді жазбаймыз. Кешірім сұраймыз." : "Понял, больше писать не будем. Извините за беспокойство.",
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
    // Пока оплаты нет, не называем цену и не показываем кнопку: обещать тариф,
    // который невозможно оплатить, и вести на мок-ссылку одинаково плохо.
    const canPay = paymentsEnabled();
    const secondLine = status.subscriptionActive
      ? lang === "kk"
        ? `Жазылым ${new Date(status.subscriptionExpiresAt!).toLocaleDateString("kk-KZ")} дейін белсенді`
        : `Подписка активна до ${new Date(status.subscriptionExpiresAt!).toLocaleDateString("ru-RU")}`
      : canPay
        ? lang === "kk"
          ? `Жазылым рәсімделмеген — шексіз үшін ${status.periodDays} күнге ${status.priceTenge} ₸`
          : `Подписка не оформлена — ${status.priceTenge} ₸ за ${status.periodDays} дней безлимита`
        : lang === "kk"
          ? `Лимит таусылса — бізге жазыңыз: ${env.supportPhone}`
          : `Если лимит закончится — напишите нам: ${env.supportPhone}`;
    const body = [
      lang === "kk"
        ? `Осы айда тегін өтінімдер: ${status.remainingFree} / ${status.freeQuota}`
        : `Бесплатных заявок в этом месяце: ${status.remainingFree} из ${status.freeQuota}`,
      secondLine,
    ].join("\n");

    // У Kaspi кнопка бессмысленна: нажимать не на что, платёж делается в
    // приложении банка. Вместо неё — номер счёта прямо здесь, чтобы человеку
    // не приходилось искать старое сообщение о лимите.
    //
    // Счёт выдаём и действующему подписчику: он может захотеть продлиться
    // заранее, а дни при оплате прибавляются к остатку, а не съедают его
    // (см. extendSubscription). Раньше здесь стояла проверка на активную
    // подписку, и человек, решивший заплатить за неделю до конца, просто не
    // мог получить номер счёта.
    if (kaspiBillerActive()) {
      const invoice = await this.billing.issueInvoice(authUser.profileId);
      const url = kaspiPayUrl(invoice.number, invoice.amountTenge);
      await this.whatsapp.sendText(
        phone,
        `${body}\n\n` +
          (lang === "kk"
            ? `Шот №${invoice.number} — ${invoice.amountTenge} ₸.\n` +
              (url ? `Төлеу: ${url}\nНемесе қолмен: ` : "") +
              `Kaspi.kz → Төлемдер → «${env.kaspiServiceName}» → шот нөмірі: ${invoice.number}\nШотты кез келген адам төлей алады.`
            : `Счёт №${invoice.number} — ${invoice.amountTenge} ₸.\n` +
              (url ? `Оплатить: ${url}\nИли вручную: ` : "") +
              `Kaspi.kz → Платежи → «${env.kaspiServiceName}» → номер счёта: ${invoice.number}\nСчёт может оплатить кто угодно.`),
      );
      return;
    }

    if (status.subscriptionActive || !canPay) {
      await this.whatsapp.sendText(phone, body);
    } else {
      await this.whatsapp.sendButtons(phone, body, [
        { id: "billing|subscribe", text: lang === "kk" ? "Жазылу рәсімдеу" : "Оформить подписку" },
      ]);
    }
  }

  private async handleSubscribeRequest(phone: string, lang: Language): Promise<void> {
    // Мок-провайдер выдаёт ссылку, включающую подписку бесплатно, — пока
    // принимать деньги нечем, отправляем к человеку. См. paymentsEnabled().
    if (!paymentsEnabled()) {
      await this.whatsapp.sendText(
        phone,
        lang === "kk"
          ? `Жазылым рәсімдеу үшін бізге жазыңыз: ${env.supportPhone}`
          : `Чтобы оформить подписку, напишите нам: ${env.supportPhone}`,
      );
      return;
    }
    const authUser = await this.authOtp.getOrCreateSupplierAuthUser(phone);
    const { paymentUrl } = await this.billing.requestSubscription(authUser.profileId);
    await this.whatsapp.sendText(phone, `${lang === "kk" ? "Жазылымға төлем" : "Оплата подписки"}: ${paymentUrl}`);
  }

  private async handleToken(chatId: string, phone: string, token: string, lang: Language): Promise<void> {
    const [kind, ...rest] = token.split("|");

    // PROSPECT-онбординг (прогрев поставщиков, см. ТЗ_прогрев_поставщиков_v2):
    // the only two buttons under the cold-outreach template. Free text never
    // reaches here — see ТЗ п.4.2, "ответ принимается только через нажатие
    // кнопки". The tapped button is the definitive language choice, since a
    // brand-new phone has no prior signal to go on — overrides whatever
    // resolveLanguage() defaulted `lang` to above.
    if (kind === "prospect" && rest[0] === "interested") {
      const chosenLang = (rest[1] === "kk" ? "kk" : "ru") as Language;
      await this.prisma.user.update({
        where: { phone: normalizePhone(phone) },
        data: { preferredLanguage: chosenLang === "kk" ? "KK" : "RU" },
      });
      await this.prospect.markResponded(phone);
      await this.onboarding.start(chatId, phone, chosenLang);
      return;
    }

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

  /**
   * Помечает последнее входящее как непонятое. Сама запись уже сделана
   * контроллером вебхука до разбора, поэтому здесь достаточно поставить флаг
   * на свежайшей строке этого номера.
   *
   * Ради этого флага всё и затевалось: он даёт список реальных формулировок,
   * на которые бот отвечает отпиской, — то есть готовый список того, что
   * стоит начать понимать, вместо догадок.
   */
  private async markUnrecognized(phone: string) {
    try {
      const last = await this.prisma.whatsAppMessage.findFirst({
        where: { phone: normalizePhone(phone), direction: "IN" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (last) {
        await this.prisma.whatsAppMessage.update({ where: { id: last.id }, data: { unrecognized: true } });
      }
    } catch {
      // Диагностика не должна ломать ответ пользователю.
    }
  }

  /**
   * Отцепляет от сессии заявку, которая больше не является «текущим
   * разговором», и возвращает true, если отцепила.
   *
   * Отцепляем в трёх случаях:
   * — заявки уже нет (удалена оператором) — иначе следующий же ход упадёт;
   * — она давно закончена: опубликована, завершена или отменена, а человек
   *   пишет заново уже про другое;
   * — это черновик, к которому не возвращались несколько часов. Человек,
   *   бросивший заполнение вчера, сегодня пишет с новым вопросом, а не
   *   продолжает ту же мысль.
   *
   * Порог намеренно в часах, а не в минутах: прерваться на десять минут
   * посреди заполнения — нормально, и терять при этом введённое было бы хуже,
   * чем ответить не по делу.
   */
  private async releaseStaleOrder(chatId: string, currentOrderId: string | null): Promise<boolean> {
    if (!currentOrderId) return false;

    const order = await this.prisma.order.findUnique({
      where: { id: currentOrderId },
      select: { status: true, updatedAt: true },
    });
    if (!order) {
      await this.sessions.clearOrder(chatId);
      return true;
    }

    const IN_PROGRESS = ["DRAFT", "CLARIFYING"];
    if (!IN_PROGRESS.includes(order.status)) {
      await this.sessions.clearOrder(chatId);
      return true;
    }

    const staleAfterMs = STALE_DRAFT_HOURS * 60 * 60 * 1000;
    if (Date.now() - order.updatedAt.getTime() > staleAfterMs) {
      await this.sessions.clearOrder(chatId);
      return true;
    }
    return false;
  }

  /** Стикер, голосовое, документ — понимать не умеем, но и молчать нельзя.
   * Вызывается из контроллера вебхука. */
  async replyUnsupportedType(phone: string): Promise<void> {
    const lang = await this.resolveLanguage(phone, undefined);
    await this.whatsapp.sendText(
      phone,
      lang === "kk"
        ? "Кешіріңіз, әзірге тек мәтінді түсінемін. Жазып жіберіңізші."
        : "Извините, пока понимаю только текст. Напишите словами, пожалуйста.",
    );
  }

  private commandHints(lang: Language): string {
    return lang === "kk"
      ? "«профиль» — санаттар мен қалалар\n«баланс» — хабарламалар мен жазылым\n«стоп» — рассылканы өшіру"
      : "«профиль» — ваши категории и города\n«баланс» — уведомления и подписка\n«стоп» — отключить рассылку";
  }

  /**
   * Ответ поставщику, написавшему что-то, чего мы не разобрали.
   *
   * Разбит на три случая, потому что раньше был один на всех, и это стоило
   * реальных людей. Холодному контакту фраза «вы зарегистрированы как
   * исполнитель» — прямая неправда: он ничего не подтверждал, мы взяли его
   * номер из справочника и написали первыми. На вопрос «вы кто?» такой ответ
   * только подтверждает худшие догадки.
   *
   * Второе подряд непонятое сообщение получает другой текст: человек уже
   * показал, что первый ему не помог, и повторить его слово в слово — значит
   * выглядеть автоответчиком. Начиная с третьего молчим: дальше это уже не
   * помощь, а навязчивость, за которую жалуются на спам.
   */
  private async replyToSupplier(
    phone: string,
    supplier: { confirmedAt: Date | null },
    lang: Language,
  ): Promise<void> {
    const misses = await this.countRecentMisses(phone);
    if (misses >= 3) return;

    if (misses >= 2) {
      await this.whatsapp.sendText(
        phone,
        lang === "kk"
          ? `Сізді түсінбей тұрмын, кешіріңіз. Тірі адамға жазыңыз: ${env.supportPhone}`
          : `Извините, не могу понять. Напишите живому человеку: ${env.supportPhone}`,
      );
      return;
    }

    if (!supplier.confirmedAt) {
      // Холодный контакт: он нас не знает. Сначала объясняем, кто пишет и
      // откуда номер, и только потом что-то предлагаем.
      await this.whatsapp.sendButtons(
        phone,
        lang === "kk"
          ? "Бұл — KerekTap, Қазақстандағы қызмет көрсету өтінімдерінің сервисі.\n\n" +
            "Нөміріңізді ашық анықтамалықтан алдық және сіздің бейініңізге сай өтінім шыққанда жазамыз. " +
            "Комиссия алмаймыз, тапсырысты өзіңіз клиентпен тікелей келісесіз.\n\n" +
            `Біз туралы толығырақ: ${suppliersPageUrl()}\n\n` +
            "Өтінімдерді алғыңыз келе ме?"
          : "Это KerekTap — сервис заявок на услуги в Казахстане.\n\n" +
            "Ваш номер мы взяли из открытого справочника и пишем, когда появляется заявка по вашему профилю. " +
            "Комиссию не берём, с клиентом договариваетесь напрямую.\n\n" +
            // Ссылка на условия: человеку, который нас не знает, коротким
            // сообщением всего не объяснишь, а проверить нас ему больше негде —
            // в холодном приглашении ссылки нет, его текст заморожен у Меты.
            `Подробно о нас: ${suppliersPageUrl()}\n\n` +
            "Присылать вам такие заявки?",
        [
          { id: `supconfirm|yes|`, text: lang === "kk" ? "Да, присылайте" : "Да, присылайте" },
          { id: `supconfirm|no|`, text: lang === "kk" ? "Жазбаңыздар" : "Не писать мне" },
        ],
      );
      return;
    }

    // Подтверждённому подсказки уместны — он уже согласился и знает, кто мы.
    // «Новая заявка» тут остаётся: поставщик тоже иногда сам заказывает.
    await this.whatsapp.sendText(
      phone,
      lang === "kk"
        ? "Сіз орындаушы ретінде қосылғансыз.\n\n" +
          this.commandHints(lang) +
          "\n\nӨзіңізге қызмет керек пе? «жаңа өтінім» деп жазыңыз."
        : "Вы подключены как исполнитель.\n\n" +
          this.commandHints(lang) +
          "\n\nНужна услуга для себя? Напишите «новая заявка».",
    );
  }

  /**
   * Первый вопрос незнакомцу: кто он.
   *
   * До этого любой нераспознанный текст немедленно заводил черновик заказа —
   * то есть система решала за человека, что он клиент, ещё до того, как он
   * что-либо сказал. Двух кнопок достаточно, чтобы не гадать.
   */
  private async askWhoTheyAre(phone: string, lang: Language): Promise<void> {
    await this.whatsapp.sendButtons(
      phone,
      lang === "kk"
        ? `Сәлеметсіз бе! Бұл KerekTap — Қазақстандағы қызмет көрсету өтінімдерінің сервисі.\n\nСізге техника керек пе, әлде өзіңіз қызмет көрсетесіз бе?\n\nОрындаушыларға арналған шарттар: ${suppliersPageUrl()}`
        : `Здравствуйте! Это KerekTap — сервис заявок на услуги в Казахстане.\n\nВам нужна техника или вы сами оказываете услуги?\n\nОб условиях для исполнителей: ${suppliersPageUrl()}`,
      [
        { id: "who|client", text: lang === "kk" ? "Қызмет керек" : "Нужна услуга" },
        { id: "who|supplier", text: lang === "kk" ? "Мен орындаушымын" : "Я исполнитель" },
      ],
    );
  }

  private async handleWhoAnswer(chatId: string, phone: string, token: string, lang: Language): Promise<void> {
    if (token === "who|supplier") {
      await this.switchToSupplier(chatId, phone, lang);
      return;
    }
    // Заявку по-прежнему не создаём: она появится от первого содержательного
    // сообщения, как и раньше. Здесь только приглашение его написать.
    await this.whatsapp.sendText(
      phone,
      lang === "kk"
        ? "Не керектігін жазыңыз — техника түрі, қала және қашан керек. Мысалы: «ертең Астанада 10 тонналық манипулятор керек»."
        : "Напишите, что нужно — техника, город и когда. Например: «нужен манипулятор 10 тонн, Астана, завтра».",
    );
  }

  /**
   * Человек оказался исполнителем, а не заказчиком.
   *
   * Черновик обязательно отцепляем: пока он привязан к чату, любое следующее
   * сообщение снова уедет в оформление заказа — именно так человек и застрял
   * на пяти одинаковых вопросах про адрес.
   */
  private async switchToSupplier(chatId: string, phone: string, lang: Language): Promise<void> {
    const session = await this.sessions.findOrCreate(chatId, phone);
    if (session.currentOrderId) {
      await this.sessions.clearOrder(chatId);
    }
    const supplier = await this.findSupplier(phone);
    if (supplier) {
      // Уже в базе — регистрировать заново незачем, показываем профиль.
      await this.whatsapp.sendText(
        phone,
        lang === "kk"
          ? "Түсіндім, сіз орындаушысыз. Сіз базадасыз — бейініңізге сай өтінім пайда болғанда жібереміз."
          : "Понял, вы исполнитель. Вы уже в базе — пришлём заявку, как появится подходящая по вашему профилю.",
      );
      await this.sendSupplierProfile(phone, lang);
      return;
    }
    await this.whatsapp.sendText(
      phone,
      lang === "kk"
        ? "Түсіндім, сіз орындаушысыз — өтінім іздеп жүрсіз. Бірнеше сұрақ қоямын, содан кейін бейініңізге сай өтінімдерді жібереміз."
        : "Понял, вы исполнитель — ищете заказы, а не технику. Задам несколько вопросов, и будем присылать заявки по вашему профилю.",
    );
    await this.onboarding.start(chatId, phone, lang);
  }

  /**
   * Ответ поставщика по заявке, которую ему прислали.
   *
   * Возвращает true, если сообщение разобрано как относящееся к заявке — тогда
   * дальше по цепочке оно не идёт.
   *
   * Заявку ищем по журналу отправок: кому ушёл order_broadcast_full и чья
   * заявка ещё не закрыта. Окно в трое суток — дольше человек про конкретный
   * заказ не пишет, а привязать вчерашнюю реплику к позавчерашней заявке
   * значит соврать в отчёте.
   *
   * Вопрос не считаем ответом: «а когда клиент перезвонит?» — это не «взял».
   */
  private async recordOrderReply(
    phone: string,
    supplier: { id: string },
    text: string,
    lang: Language,
  ): Promise<boolean> {
    if (looksLikeQuestion(text) && !AGREED_RE.test(text) && !DECLINED_RE.test(text)) return false;

    const order = await this.openOrderFor(supplier.id);
    if (!order) return false;

    const agreed = AGREED_RE.test(text);
    const declined = !agreed && DECLINED_RE.test(text);
    const outcome = agreed ? "agreed" : declined ? "declined" : "comment";

    await this.prisma.supplierOrderReply.create({
      data: { orderId: order.id, supplierId: supplier.id, text: text.trim(), outcome },
    });

    const n = order.number;
    const reply = agreed
      ? lang === "kk"
        ? `Жақсы, №${n} өтінім бойынша белгіледім. Бірдеңе өзгерсе — жазыңыз.`
        : `Отлично, отметил по заявке №${n}. Если что-то изменится — напишите.`
      : declined
        ? lang === "kk"
          ? `Түсіндім, №${n} өтінімді алмайсыз. Хабарлағаныңызға рахмет — басқаларға ұсынамыз.`
          : `Понял, заявку №${n} вы не берёте. Спасибо, что сообщили — предложим другим.`
        : lang === "kk"
          ? `№${n} өтінім бойынша жазып алдым. Сұрақ болса: ${env.supportPhone}`
          : `Записал по заявке №${n}. Если нужен живой человек: ${env.supportPhone}`;
    await this.whatsapp.sendText(phone, reply);
    return true;
  }

  /**
   * Ответ на «есть ещё заказы?» — по существу, а не меню команд.
   *
   * Сначала смотрим, нет ли у него уже открытой заявки: сказать «заявок нет»
   * человеку, которому её прислали час назад, — прямая неправда, и он решит,
   * что мы её отозвали.
   */
  private async replyAboutOpenOrders(phone: string, supplier: { id: string }, lang: Language): Promise<void> {
    const open = await this.openOrderFor(supplier.id);
    if (open) {
      await this.whatsapp.sendText(
        phone,
        lang === "kk"
          ? `Соңғы жіберілген №${open.number} өтінімі әлі ашық. Басқа өтінім жоқ — пайда болғанда бірден жібереміз.`
          : `Последняя отправленная вам заявка №${open.number} ещё открыта. Других сейчас нет — как появятся, пришлём сразу.`,
      );
      return;
    }
    // «Обязательно» в начале — потому что половина таких сообщений это не
    // вопрос, а предложение себя: «если будет заявка, обращайтесь». На него
    // «заявок нет» звучит как отказ, хотя человек ничего не спрашивал.
    await this.whatsapp.sendText(
      phone,
      lang === "kk"
        ? "Міндетті түрде. Бейініңізге сай өтінім пайда болған сәтте бірден жібереміз — іздеудің қажеті жоқ.\nҚазір ашық өтінім жоқ.\n«профиль» — санаттар мен қалаларды кеңейту, сонда өтінім көбірек болады."
        : "Обязательно. Как появится заявка по вашему профилю — пришлём сразу, искать не нужно.\nСейчас открытых заявок нет.\n«профиль» — расширить категории и города, тогда заявок будет больше.",
    );
  }

  /** Последняя присланная этому поставщику заявка, которая ещё не закрыта. */
  private async openOrderFor(supplierId: string) {
    const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const logs = await this.prisma.notificationLog.findMany({
      where: {
        supplierId,
        templateKey: "order_broadcast_full",
        createdAt: { gt: since },
        orderId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { orderId: true },
      take: 20,
    });
    const ids = [...new Set(logs.map((l) => l.orderId!))];
    if (ids.length === 0) return null;
    return this.prisma.order.findFirst({
      where: { id: { in: ids }, status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      select: { id: true, number: true },
    });
  }

  /**
   * Похоже ли сообщение на рассказ о себе. Порог намеренно осторожный: в
   * профиль попадает только то, за что не стыдно перед оператором, поэтому
   * сомнительное уходит в обычный ответ с подсказками, а не в заметку.
   * Название города считается достаточным сигналом само по себе — Нурбек
   * прислал ровно «Астана» отдельным сообщением.
   */
  private looksLikeSelfInfo(text: string): boolean {
    const t = text.trim();
    if (PLEASANTRIES.has(t.toLowerCase().replace(/[.!]+$/, ""))) return false;
    if (looksLikeQuestion(t)) return false;
    return findCitiesInText(t).length > 0 || t.length >= 12;
  }

  /**
   * Поставщик написал о себе — «У меня автокран 25тн, стрела 42 метра»,
   * «Астана». Такие сообщения приходили в ответ на приглашение и молча
   * пропадали: категория из импортированного справочника у человека уже
   * заполнена, поэтому ни один сценарий «дособери профиль» не включался, а
   * роутер считал текст непонятым.
   *
   * Три вещи, по убыванию важности: сохранить сказанное (иначе оно потеряно
   * навсегда), показать человеку, что его услышали (иначе он больше не
   * напишет), и подобрать из текста то, что можно применить сразу — город.
   *
   * Город не добавляем молча: в «а по Караганде заявки бывают?» название
   * тоже есть, а зона работы от этого не меняется. Спрашиваем кнопкой.
   */
  private async captureSupplierInfo(
    phone: string,
    supplier: { id: string; selfDescription: string | null; serviceAreas: { city: string }[] },
    text: string,
    lang: Language,
  ): Promise<void> {
    const clean = text.trim();
    // Накапливаем: люди пишут о себе в несколько сообщений подряд, и второе
    // не должно затирать первое. Ограничение — чтобы одна залипшая клавиатура
    // не превратила поле в мегабайт текста.
    const merged = [supplier.selfDescription, clean].filter(Boolean).join("\n").slice(-4000);
    await this.prisma.supplierProfile.update({
      where: { id: supplier.id },
      data: { selfDescription: merged, selfDescriptionAt: new Date() },
    });

    const known = new Set(supplier.serviceAreas.map((a) => a.city.toLowerCase()));
    const fresh = findCitiesInText(clean).filter((c) => !known.has(c.name.ru.toLowerCase()));

    const echo = clean.length > 140 ? `${clean.slice(0, 140)}…` : clean;
    const head = lang === "kk" ? `Жазып алдым: «${echo}»` : `Записал: «${echo}»`;

    if (fresh.length > 0) {
      const names = fresh.map((c) => c.name[lang]).join(", ");
      await this.whatsapp.sendButtons(
        phone,
        lang === "kk"
          ? `${head}\n\nСіз ${names} қаласында да жұмыс істейсіз бе? Солай болса, өтінімдерді сол жақтан да жібереміз.`
          : `${head}\n\nВы работаете и в городе ${names}? Тогда будем присылать заявки и оттуда.`,
        [
          { id: `supcity|add|${fresh.map((c) => c.slug).join(",")}`, text: lang === "kk" ? "Иә, қосыңыз" : "Да, добавьте" },
          { id: "supcity|skip|", text: lang === "kk" ? "Жоқ, керегі жоқ" : "Нет, не надо" },
        ],
      );
      return;
    }

    await this.whatsapp.sendText(
      phone,
      lang === "kk"
        ? `${head}\n\nПрофиліңізге қостық — қолайлы өтінімдерді таңдағанда ескереміз.\nӨзгерту үшін «профиль» деп жазыңыз.`
        : `${head}\n\nДобавил к вашему профилю — учтём при подборе заявок.\nЧтобы изменить профиль, напишите «профиль».`,
    );
  }

  /** Ответ на предложение добавить город из captureSupplierInfo(). */
  private async handleCityOffer(phone: string, token: string, lang: Language): Promise<void> {
    const slugs = token.split("|")[2]?.split(",").filter(Boolean) ?? [];
    if (slugs.length === 0) {
      await this.whatsapp.sendText(
        phone,
        lang === "kk" ? "Жарайды, қалаларды өзгертпедік." : "Хорошо, города оставил как были.",
      );
      return;
    }
    const supplier = await this.findSupplier(phone);
    if (!supplier) return;

    const known = new Set(supplier.serviceAreas.map((a) => a.city.toLowerCase()));
    const added: string[] = [];
    for (const slug of slugs) {
      const city = CITIES.find((c) => c.slug === slug);
      if (!city || known.has(city.name.ru.toLowerCase())) continue;
      // Храним каноническое русское имя — на него смотрит citiesServing() при
      // подборе, и разнобой здесь означал бы поставщика, которого не находит
      // ни одна заявка.
      await this.prisma.serviceArea.create({ data: { supplierId: supplier.id, city: city.name.ru } });
      added.push(city.name[lang]);
    }
    await this.whatsapp.sendText(
      phone,
      added.length > 0
        ? lang === "kk"
          ? `Қостық: ${added.join(", ")}. Сол қалалардың өтінімдері де келеді.`
          : `Добавил: ${added.join(", ")}. Заявки оттуда тоже будут приходить.`
        : lang === "kk"
          ? "Бұл қалалар профиліңізде бұрыннан бар."
          : "Эти города уже были в вашем профиле.",
    );
  }

  /** Сколько последних входящих подряд мы не поняли — см. replyToSupplier(). */
  private async countRecentMisses(phone: string): Promise<number> {
    try {
      const recent = await this.prisma.whatsAppMessage.findMany({
        where: { phone: normalizePhone(phone), direction: "IN" },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { unrecognized: true },
      });
      let n = 0;
      for (const m of recent) {
        if (!m.unrecognized) break;
        n++;
      }
      return n;
    } catch {
      return 1; // диагностика не должна менять поведение ответа
    }
  }

  private async findSupplier(phone: string) {
    return this.prisma.supplierProfile.findFirst({
      where: { user: { phone: normalizePhone(phone) } },
      include: { categories: { include: { category: true } }, serviceAreas: true, subscription: true },
    });
  }

  /** Self-service pause. Deliberately not isBlocked: that's an admin
   * punishment, while this is a supplier stepping out for a while and
   * expecting one word to bring them back. Dispatch already filters on
   * activityStatus === "ACTIVE" (matching.service.ts), so pausing is enough. */
  private async setSupplierPaused(phone: string, paused: boolean, lang: Language): Promise<void> {
    const supplier = await this.findSupplier(phone);
    if (!supplier) {
      await this.whatsapp.sendText(
        phone,
        lang === "kk"
          ? "Сіз орындаушы ретінде тіркелмегенсіз, сондықтан сізге өтінімдер жіберілмейді."
          : "Вы не зарегистрированы как исполнитель — заявки вам и так не приходят.",
      );
      return;
    }
    await this.prisma.supplierProfile.update({
      where: { id: supplier.id },
      data: { activityStatus: paused ? "PAUSED" : "ACTIVE" },
    });
    await this.whatsapp.sendText(
      phone,
      paused
        ? lang === "kk"
          ? "Рассылка тоқтатылды — бұдан былай өтінімдер жіберілмейді.\nҚайта қосу үшін «жалғастыру» деп жазыңыз."
          : "Рассылка отключена — заявки больше приходить не будут.\nЧтобы включить обратно, напишите «возобновить»."
        : lang === "kk"
          ? "Рассылка қайта қосылды — өтінімдер қайтадан келеді."
          : "Рассылка включена — заявки снова будут приходить.",
    );
  }

  private async sendSupplierProfile(phone: string, lang: Language): Promise<void> {
    const supplier = await this.findSupplier(phone);
    if (!supplier) {
      await this.whatsapp.sendText(
        phone,
        lang === "kk"
          ? "Сіз орындаушы ретінде тіркелмегенсіз. Тіркелу үшін «жеткізуші» деп жазыңыз."
          : "Вы не зарегистрированы как исполнитель. Чтобы зарегистрироваться, напишите «поставщик».",
      );
      return;
    }
    const cats = supplier.categories
      .map((c) => (c.category.name as unknown as LocalizedText)[lang])
      .join(", ");
    const cities = supplier.serviceAreas.map((a) => a.city).join(", ");
    const paused = supplier.activityStatus !== "ACTIVE";
    const used = supplier.notificationsUsedThisMonth;
    const free = env.freeNotificationsPerMonth;

    // Показываем и то, что человек рассказал о себе сам: без этой строки он
    // не видит, что его слова вообще сохранились, и пишет их заново.
    const about = supplier.selfDescription?.trim();
    const aboutLine = about
      ? `\n${lang === "kk" ? "Өзіңіз туралы" : "С ваших слов"}: ${about.length > 200 ? `${about.slice(-200)}…` : about}\n`
      : "";

    const body =
      lang === "kk"
        ? `${supplier.companyName ?? "Орындаушы"}\n` +
          `Санаттар: ${cats || "жоқ"}\n` +
          `Қалалар: ${cities || "жоқ"}\n` +
          aboutLine +
          `Айдағы хабарламалар: ${used} / ${free}\n` +
          `Рассылка: ${paused ? "өшірілген" : "қосулы"}\n\n` +
          `«жеткізуші» — санаттар мен қалаларды өзгерту\n` +
          `«баланс» — жазылым\n` +
          `«${paused ? "жалғастыру" : "стоп"}» — рассылканы ${paused ? "қосу" : "өшіру"}`
        : `${supplier.companyName ?? "Исполнитель"}\n` +
          `Категории: ${cats || "не выбраны"}\n` +
          `Города: ${cities || "не указаны"}\n` +
          aboutLine +
          `Уведомлений за месяц: ${used} из ${free} бесплатных\n` +
          `Рассылка: ${paused ? "отключена" : "включена"}\n\n` +
          `«поставщик» — изменить категории и города\n` +
          `«баланс» — подписка\n` +
          `«${paused ? "возобновить" : "стоп"}» — ${paused ? "включить" : "отключить"} рассылку`;
    await this.whatsapp.sendText(phone, body);
  }

  private async handleText(chatId: string, phone: string, text: string, lang: Language): Promise<void> {
    const session = await this.sessions.findOrCreate(chatId, phone);

    if (session.currentOrderId) {
      const order = await this.orders.getRawOrThrow(session.currentOrderId);
      // A finished order has nothing left to say. Holding the session on it
      // turned every later message into a replay of its final status, with
      // the only escape being the exact phrase "новая заявка" — which nobody
      // is told about. Release it and let the message start a fresh order.
      if (FINISHED_STATUSES.includes(order.status)) {
        await this.sessions.clearOrder(chatId);
      } else if (!DRAFT_STATUSES.includes(order.status)) {
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
              { id: `complete|resolved|${session.currentOrderId}`, text: lang === "kk" ? "Қызмет көрсетілді" : "Услуга оказана" },
              { id: `complete|redispatch|${session.currentOrderId}`, text: lang === "kk" ? "Басқасын ұсыну" : "Отправить повторно" },
              { id: `complete|closed|${session.currentOrderId}`, text: lang === "kk" ? "Өтінімді жабу" : "Закрыть заявку" },
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

    // Брошенный черновик не должен владеть чатом вечно. Пока он привязан к
    // сессии, проверка ниже не срабатывает, и поставщик, однажды начавший
    // заявку для себя и бросивший её, НАВСЕГДА застревает в режиме
    // оформления: на каждое «здравствуйте» получает выбор категории.
    const releasedStale = await this.releaseStaleOrder(chatId, session.currentOrderId);
    // ensureOrder() ниже перечитывает сессию из базы и увидит очищенное поле,
    // поэтому здесь достаточно локального значения для проверки.
    const currentOrderId = releasedStale ? null : session.currentOrderId;

    // A registered supplier saying "спасибо" or "сколько стоит подписка" was
    // being funnelled into drafting an order for themselves — the router
    // treats every unrecognised message as a client request. That filled the
    // base with abandoned drafts and left the supplier with a bot asking what
    // they need. Answer with what they can actually do instead, and keep an
    // explicit way through for the times they really do want to order.
    if (!currentOrderId && !NEW_ORDER_PHRASES.test(text)) {
      const supplier = await this.findSupplier(phone);
      if (supplier) {
        // Молчим на «спасибо» и «👍». Это не вопрос и не сообщение — человек
        // подтвердил, что прочитал. Меню команд в ответ на лайк выглядит так,
        // будто с ним говорит автомат, и засоряет метрику «бот не понял»,
        // по которой мы ищем настоящие проблемы.
        if (isAcknowledgement(text)) return;

        if (supplier.confirmedAt) {
          // Заявка важнее профиля. Человек, которому только что прислали
          // заявку с телефоном клиента, следующим сообщением пишет про неё —
          // и это самое ценное, что сервис может услышать: взял или нет.
          // Раньше «Вроде договорились, клиент озвонится» оседало в описании
          // техники, а заявка так и висела опубликованной.
          // Просьба о работе проверяется ПЕРВОЙ. «Есть ещё заказы» у человека
          // с открытой заявкой иначе попало бы в исход по ней и получило бы
          // «записал по заявке №76» — при том что спрашивают про другое.
          if (MORE_ORDERS_RE.test(text)) {
            await this.replyAboutOpenOrders(phone, supplier, lang);
            return;
          }

          if (await this.recordOrderReply(phone, supplier, text, lang)) return;

          if (this.looksLikeSelfInfo(text)) {
            await this.captureSupplierInfo(phone, supplier, text, lang);
            return;
          }
        }
        await this.markUnrecognized(phone);
        await this.replyToSupplier(phone, supplier, lang);
        return;
      }
    }

    const orderId = await this.ensureOrder(chatId, phone);
    const turn = await this.orders.chat(orderId, text, lang);
    // Третий одинаковый вопрос подряд — это не диалог, а стена. Человек уже
    // дважды показал, что не понимает, чего от него хотят; повторить в третий
    // раз то же самое значит потерять его окончательно.
    if (await this.isRepeating(orderId, turn.assistantMessage)) {
      await this.escalateStuckDialogue(phone, lang);
      return;
    }
    await this.sendTurn(chatId, phone, turn, lang);
  }

  /** Задавали ли мы уже этот же вопрос дважды подряд. */
  private async isRepeating(orderId: string, message: string): Promise<boolean> {
    try {
      const recent = await this.prisma.chatMessage.findMany({
        where: { orderId, role: "ASSISTANT" },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { content: true },
      });
      // Свежая реплика уже записана applyFieldUpdate(), поэтому считаем от
      // трёх: сама она и две такие же до неё.
      return recent.length >= 3 && recent.every((m) => m.content === message);
    } catch {
      return false; // диагностика не должна ломать разговор
    }
  }

  /**
   * Выход из тупика. Не повторяем вопрос, а признаём, что не справились, и
   * даём два выхода: живого человека и путь для исполнителя — потому что
   * половина застрявших это исполнители, попавшие в оформление заказа.
   */
  private async escalateStuckDialogue(phone: string, lang: Language): Promise<void> {
    await this.whatsapp.sendButtons(
      phone,
      lang === "kk"
        ? `Кешіріңіз, мен сізді түсінбей тұрмын.\n\nТірі адамға жазыңыз: ${env.supportPhone}`
        : `Извините, я вас не понимаю.\n\nНапишите живому человеку: ${env.supportPhone}`,
      [{ id: "who|supplier", text: lang === "kk" ? "Мен орындаушымын" : "Я исполнитель" }],
    );
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
    // Заявка из чата: без пометки её потом не отличить от веб-заявки, а
    // разбирать «почему человек застрял» без этого нельзя — на сайте и в
    // WhatsApp обрываются на разном.
    const draft = await this.orders.createDraft(undefined, false, {
      channel: "WHATSAPP",
      ...this.sessions.adAttribution(session),
    });
    // Владельца привязываем сразу, не дожидаясь публикации. Анонимность
    // черновика придумана для сайта, где человек ещё не назвал телефон — в
    // WhatsApp номер и есть канал, он известен с первого сообщения и
    // подтверждён самим фактом переписки.
    //
    // Без этого недооформленная заявка выглядела в админке как «нет
    // телефона»: заявка №80 (самосвал, песок, 20 м³) висела с заполненными
    // полями и без единого способа перезвонить, хотя номер лежал в сессии
    // рядом. Именно на таких и нужен оператор — доводить брошенное.
    const authUser = await this.authOtp.getOrCreateClientAuthUser(phone);
    await this.orders.attachClient(draft.id, authUser.profileId);
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
