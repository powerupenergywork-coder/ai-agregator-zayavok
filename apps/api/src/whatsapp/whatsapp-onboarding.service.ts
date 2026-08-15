import { Inject, Injectable, Logger } from "@nestjs/common";
import { Language, citySuggestions, looksLikeQuestion, resolveCityList } from "@ai-zayavki/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CategoriesService } from "../categories/categories.service";
import { AuditLogService } from "../common/audit-log.service";
import { normalizePhone } from "../common/phone.util";
import { WHATSAPP_PROVIDER, WhatsAppProvider } from "./whatsapp-provider.interface";
import { WhatsAppSessionService } from "./whatsapp-session.service";
import { phoneToChatId } from "./whatsapp.util";
import { renderCategoryQuestion, renderOnboardingConfirm, renderYesNo } from "./whatsapp-onboarding-render.util";
import { ProspectService } from "../prospect/prospect.service";
import { IncomingWhatsAppMessage } from "./whatsapp.types";

type Step = "company_name" | "categories" | "other_category" | "cities" | "urgent" | "hours" | "confirm";

/** Голые «да»/«нет» на шаге категорий — попытка ответить словами на текущий
 *  вопрос, а не название своей услуги. См. разбор шага «categories». */
const YES_NO_WORDS = new Set(["да", "нет", "ага", "не", "иә", "ия", "жоқ", "жок"]);

interface Collected {
  companyName?: string;
  categorySlugs: string[];
  cities: string[];
  acceptsUrgent?: boolean;
  /** undefined = not answered (use the global default window); true = explicit
   * round-the-clock opt-out; false = explicit default-hours confirmation. */
  roundTheClock?: boolean;
}

interface OnboardingState {
  step: Step;
  collected: Collected;
  /** Position in the active-category list while step === "categories" — one
   * Yes/No button question per category instead of a numbered multi-select
   * list, see renderCategoryQuestion(). */
  categoryIndex?: number;
  pendingOptions?: Record<string, string>;
  isNewSupplier: boolean;
}

// Exact-phrase match on purpose, not a substring like /поставщик/ — a client
// order such as "Ищу поставщика песка" would otherwise misfire into
// onboarding. Production would use a dedicated wa.me link with pre-filled
// text instead of guessing intent from freeform chat.
// Kazakh equivalents included so a brand-new supplier can start registration
// in Kazakh from their very first message — the Russian-only phrases have no
// Kazakh-unique letters, so detectLanguage() alone can't catch that intent.
const TRIGGER_PHRASES = new Set([
  "поставщик",
  "регистрация",
  "стать исполнителем",
  "мои услуги",
  "я поставщик",
  "жеткізуші",
  "тіркелу",
  "орындаушы болу",
  "менің қызметтерім",
  "мен жеткізушімін",
  // Подписи кнопок из рекламы в Instagram и Facebook. Текст кнопки там
  // выбирается из закрытого списка Меты, своего не вписать — «Я поставщик»
  // поставить нельзя, «Присоединиться» можно. Поэтому подстраиваемся мы:
  // дешевле добавить слово сюда, чем терять регистрации из рекламы.
  "присоединиться",
  "присоединяюсь",
  "қосылу",
  "қосыламын",
]);

export function isOnboardingTrigger(text: string): boolean {
  return TRIGGER_PHRASES.has(text.trim().toLowerCase());
}

@Injectable()
export class WhatsAppOnboardingService {
  private readonly logger = new Logger(WhatsAppOnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly audit: AuditLogService,
    private readonly sessions: WhatsAppSessionService,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
    private readonly prospect: ProspectService,
  ) {}

  async start(chatId: string, phone: string, lang: Language = "ru"): Promise<void> {
    const normalized = normalizePhone(phone);
    const existing = await this.prisma.supplierProfile.findFirst({
      where: { user: { phone: normalized } },
      include: { categories: { include: { category: true } }, serviceAreas: true },
    });

    const collected: Collected = existing
      ? {
          companyName: existing.companyName ?? undefined,
          categorySlugs: existing.categories.map((c) => c.category.slug),
          cities: existing.serviceAreas.map((a) => a.city),
          acceptsUrgent: existing.acceptsUrgent,
          roundTheClock:
            existing.workingHoursStart === "00:00" && existing.workingHoursEnd === "23:59" ? true : undefined,
        }
      : { categorySlugs: [], cities: [] };

    await this.saveState(chatId, { step: "company_name", collected, isNewSupplier: !existing });
    await this.whatsapp.sendText(
      phone,
      existing
        ? lang === "kk"
          ? `Поставщик профиліңізді жаңартамыз. Компанияңыздың атауы қандай? (қазір: ${existing.companyName ?? "көрсетілмеген"})`
          : `Обновим ваш профиль поставщика. Как называется компания? (сейчас: ${existing.companyName ?? "не указано"})`
        : // Сначала объясняем, потом спрашиваем.
          //
          // Прежний текст сразу требовал название компании — и четверо из
          // пятерых на этом замолкали. Человек написал одно слово, ещё не
          // понимая, куда попал, а с него уже спрашивают реквизиты. У частника
          // компании нет вовсе, и вопрос ставит в тупик.
          //
          // «Можно просто имя» снимает ступор: большинство наших исполнителей
          // работают сами на себя.
          lang === "kk"
          ? "Сізді орындаушы ретінде тіркейміз — үш сұрақ, бір минут.\n\nЖіберетініміз: қаланыздағы клиенттердің өтінімдері, телефонымен. Тікелей келісесіз, тапсырыстан комиссия алмаймыз.\n\nСізді қалай жазайық? Жеке жұмыс істесеңіз, жай атыңызды жазсаңыз болады."
          : "Зарегистрирую вас как исполнителя — три вопроса, займёт минуту.\n\nЧто будем присылать: заявки от клиентов в вашем городе, с телефоном заказчика. Договариваетесь напрямую, комиссию с заказа не берём.\n\nКак вас записать? Можно просто имя, если работаете сами.",
    );
  }

  async handleIncoming(chatId: string, phone: string, msg: IncomingWhatsAppMessage, lang: Language = "ru"): Promise<void> {
    const state = await this.loadState(chatId);
    if (!state) {
      await this.start(chatId, phone, lang);
      return;
    }

    let token = msg.buttonReplyId;
    if (!token && msg.text && /^\d+$/.test(msg.text.trim())) {
      token = state.pendingOptions?.[msg.text.trim()];
    }

    if (state.step === "company_name") {
      if (!msg.text?.trim()) {
        await this.whatsapp.sendText(phone, lang === "kk" ? "Компания атауын мәтінмен жазыңыз." : "Напишите название компании текстом.");
        return;
      }
      const name = msg.text.trim();
      // Не имя, а повтор команды или вопрос. Реальные случаи: человек ответил
      // «поставщик» — тем же словом, которым запускал регистрацию, — и в базе
      // появился исполнитель с названием «поставщик»; другой ответил
      // «Здравствуйте, как Я понял Вы находите работу для техники?», и вопрос
      // осел в поле названия компании.
      //
      // Переспрашиваем один раз: имя записывается в карточку заявки, которую
      // увидит клиент, и мусор там дороже лишнего вопроса.
      if (isOnboardingTrigger(name) || looksLikeQuestion(name)) {
        await this.whatsapp.sendText(
          phone,
          lang === "kk"
            ? "Бұл сұрақ болып тұр 🙂 Сізді қалай атайық? Атыңыз немесе компанияңыздың атауы — мысалы «Асхат» немесе «ТОО Стройтех»."
            : "Кажется, это вопрос, а не имя 🙂 Как вас записать? Имя или название компании — например «Асхат» или «ТОО Стройтех».",
        );
        return;
      }
      state.collected.companyName = name;
      await this.goToCategories(chatId, phone, state, lang);
      return;
    }

    if (state.step === "categories") {
      if (token === "sup|catnone") {
        state.step = "other_category";
        await this.saveState(chatId, state);
        await this.whatsapp.sendText(
          phone,
          lang === "kk"
            ? "Не істейтіңізді жазыңыз — техника немесе қызмет атауы. Бір хабарламамен жеткілікті."
            : "Напишите, что у вас за техника или услуга. Одним сообщением, своими словами.",
        );
        return;
      }
      if (!token || !token.startsWith("sup|cat|")) {
        // Слова вместо кнопки — не мусор, а ответ. «У меня минипогрузчик»
        // дважды получило «Ответьте кнопкой выше» и пропало. Теперь текст на
        // этом шаге считаем тем же, чем и кнопка «Другое»: человек называет
        // то, чего нет в списке.
        // Кроме голых «да»/«нет»: это попытка ответить на текущий вопрос
        // словами, а не название своей услуги. Записать «Просит категорию:
        // да» — хуже, чем попросить нажать кнопку.
        const bare = msg.text?.trim().toLowerCase().replace(/[.!?]+$/, "") ?? "";
        if (bare && !YES_NO_WORDS.has(bare)) {
          state.step = "other_category";
          await this.saveState(chatId, state);
          await this.handleOtherCategory(chatId, phone, state, msg.text!, lang);
          return;
        }
        await this.whatsapp.sendText(phone, lang === "kk" ? "Жоғарыдағы батырмамен жауап беріңіз." : "Ответьте кнопкой выше.");
        return;
      }
      const parts = token.split("|"); // ["sup", "cat", "<slug>", "true"|"false"]
      const slug = parts[2];
      const accepted = parts[3] === "true";
      const existingIdx = state.collected.categorySlugs.indexOf(slug);
      if (accepted && existingIdx < 0) state.collected.categorySlugs.push(slug);
      if (!accepted && existingIdx >= 0) state.collected.categorySlugs.splice(existingIdx, 1);

      // Кнопки в WhatsApp остаются живыми навсегда: человек может пролистать
      // вверх и нажать на старом вопросе. Так и вышло у реального поставщика —
      // под вопросом «Грузчики» он нажал кнопку из вопроса про Газель,
      // заданного минутой раньше. Мы засчитали это как ответ на текущий вопрос
      // и шагнули дальше: грузчики остались неспрошенными и молча пропали, а
      // газель, которую он до этого отклонил, включилась.
      //
      // Поэтому ответ применяем к той категории, что зашита в кнопке (человек
      // ответил именно про неё, и это надо уважить), а счётчик двигаем только
      // если нажали под текущим вопросом. Иначе текущий вопрос задаётся снова.
      const allCategories = await this.categories.findAllActive();
      const current = allCategories[state.categoryIndex ?? 0];
      if (current && slug === current.slug) {
        state.categoryIndex = (state.categoryIndex ?? 0) + 1;
      } else {
        this.logger.log(`Нажата кнопка старого вопроса (${slug}), текущий — ${current?.slug ?? "—"}; спрашиваю заново`);
      }
      await this.saveState(chatId, state);
      await this.askNextCategory(chatId, phone, state, lang);
      return;
    }

    if (state.step === "other_category") {
      if (!msg.text?.trim()) {
        await this.whatsapp.sendText(
          phone,
          lang === "kk" ? "Не істейтіңізді мәтінмен жазыңыз." : "Напишите текстом, что у вас за техника или услуга.",
        );
        return;
      }
      await this.handleOtherCategory(chatId, phone, state, msg.text, lang);
      return;
    }

    if (state.step === "cities") {
      if (!msg.text?.trim()) {
        await this.whatsapp.sendText(phone, lang === "kk" ? "Қалаларды мәтінмен, үтір арқылы жазыңыз." : "Напишите города текстом, через запятую.");
        return;
      }
      // Нераспознанное не сохраняем как город: он молча не совпал бы ни с
      // одной заявкой, и поставщик ждал бы работы, которая никогда не придёт.
      //
      // Но и переспрашивать всю строку из-за лишнего куска нельзя. Реальный
      // ответ: «Астана, оплата наличными и без наличными» — город назван, а мы
      // отвергли всё целиком и заставили писать заново. Поэтому переспрашиваем
      // только когда не распознан НИ ОДИН город; иначе берём распознанные, а
      // остаток убираем в заметку о поставщике: условия оплаты хранить больше
      // негде, а выбрасывать сказанное человеком — то же самое, что не слушать.
      const { cities, unresolved } = resolveCityList(msg.text);
      if (cities.length === 0) {
        await this.whatsapp.sendText(
          phone,
          lang === "kk"
            ? `Мына қаланы танымадым: ${unresolved.join(", ") || msg.text}.\nБіз жұмыс істейтін қалалар: ${citySuggestions("kk")} және басқалары.\nҚайта жазып көріңізші.`
            : `Не узнал город: ${unresolved.join(", ") || msg.text}.\nМы работаем в городах: ${citySuggestions("ru")} и другие.\nНапишите ещё раз, пожалуйста.`,
        );
        return;
      }
      if (unresolved.length > 0) {
        const aside = unresolved.join(", ");
        await this.noteAside(phone, aside);
        await this.whatsapp.sendText(
          phone,
          lang === "kk"
            ? `Қалалар: ${cities.map((c) => c.name.kk).join(", ")}.\n«${aside}» — қала емес деп түсіндім, бірақ профиліңізге жазып алдым. Егер бұл қала болса, кейін «жеткізуші» деп жазып түзетіңіз.`
            : `Города: ${cities.map((c) => c.name.ru).join(", ")}.\n«${aside}» — как город не распознал, но записал к вашему профилю. Если это всё-таки город, поправьте позже командой «поставщик».`,
        );
      }
      state.collected.cities = cities.map((c) => c.name.ru);
      state.step = "urgent";
      await this.saveState(chatId, state);
      const rendered = renderYesNo(
        lang === "kk" ? "Жедел тапсырыстарды қабылдайсыз ба?" : "Принимаете срочные заказы?",
        "sup|urgent",
        lang,
      );
      await this.whatsapp.sendButtons(phone, rendered.body, rendered.buttons!);
      return;
    }

    if (state.step === "urgent") {
      if (!token || !token.startsWith("sup|urgent|")) {
        await this.whatsapp.sendText(phone, lang === "kk" ? "Жоғарыдағы батырмамен Иә немесе Жоқ деп жауап беріңіз." : "Ответьте Да или Нет кнопкой выше.");
        return;
      }
      state.collected.acceptsUrgent = token.endsWith("true");
      state.step = "hours";
      await this.saveState(chatId, state);
      await this.whatsapp.sendButtons(
        phone,
        lang === "kk"
          ? "Өтінімдерді тәулік бойы алғыңыз келе ме, әлде тек жұмыс сағаттарында ма (08:00–21:00)?"
          : "Получать заявки в любое время суток или только в рабочие часы (08:00–21:00)?",
        [
          { id: "sup|hours|true", text: lang === "kk" ? "Тәулік бойы" : "Круглосуточно" },
          { id: "sup|hours|false", text: lang === "kk" ? "Тек 08:00–21:00" : "Только 08:00–21:00" },
        ],
      );
      return;
    }

    if (state.step === "hours") {
      if (!token || !token.startsWith("sup|hours|")) {
        await this.whatsapp.sendText(phone, lang === "kk" ? "Жоғарыдағы батырмалардың бірін таңдаңыз." : "Выберите один из вариантов кнопкой выше.");
        return;
      }
      state.collected.roundTheClock = token.endsWith("true");
      state.step = "confirm";
      await this.saveState(chatId, state);
      await this.sendConfirm(phone, state, lang);
      return;
    }

    if (state.step === "confirm") {
      if (token === "sup|confirm") {
        await this.persist(phone, state, lang);
        return;
      }
      if (token === "sup|restart") {
        state.step = "company_name";
        await this.saveState(chatId, state);
        await this.whatsapp.sendText(
          phone,
          lang === "kk"
            ? `Жарайды, қайтадан бастайық. Компания атауы? (қазір: ${state.collected.companyName ?? "—"})`
            : `Хорошо, начнём заново. Название компании? (сейчас: ${state.collected.companyName ?? "—"})`,
        );
        return;
      }
      await this.whatsapp.sendText(phone, lang === "kk" ? "Жоғарыда «Растау» немесе «Өзгерту» батырмасын басыңыз." : "Нажмите «Подтвердить» или «Изменить» выше.");
    }
  }

  /**
   * Сказанное между делом — в заметку о поставщике.
   *
   * «Астана, оплата наличными и без наличными»: город мы взяли, а условия
   * оплаты девать некуда — отдельного поля для них нет. Выбросить проще, но
   * это ровно то, за что людей раздражает разговор с автоматом: сказал —
   * пропало. Складываем туда же, где лежат его слова о технике.
   */
  private async noteAside(phone: string, text: string): Promise<void> {
    try {
      const supplier = await this.prisma.supplierProfile.findFirst({
        where: { user: { phone: normalizePhone(phone) } },
        select: { id: true, selfDescription: true },
      });
      if (!supplier) return; // профиля ещё нет — заметку сохранит persist()
      const merged = [supplier.selfDescription, text].filter(Boolean).join("\n").slice(-4000);
      await this.prisma.supplierProfile.update({
        where: { id: supplier.id },
        data: { selfDescription: merged, selfDescriptionAt: new Date() },
      });
    } catch (err) {
      // Заметка полезна, но не настолько, чтобы из-за неё сорвать регистрацию.
      this.logger.warn(`Не удалось записать заметку о поставщике: ${(err as Error).message}`);
    }
  }

  /**
   * Услуга, которой у нас нет: записываем и говорим правду.
   *
   * Соблазн — ответить «обязательно пришлём, как появится заявка». Ровно так
   * бот и ответил владельцу минипогрузчика 15 августа, и это обещание нечем
   * исполнить: категории нет, заявка по ней прийти не может, человек ждёт
   * впустую. Обещание, которое некому исполнить, хуже отказа.
   *
   * Профиль всё равно заводим: без него незачем и спрашивать, а с ним запрос
   * виден в админке и человеку есть куда вернуться. Категорий у профиля ноль,
   * поэтому рассылка его не увидит — matching.service.ts подбирает строго по
   * категории, лишних заявок не придёт.
   */
  private async handleOtherCategory(
    chatId: string,
    phone: string,
    state: OnboardingState,
    text: string,
    lang: Language,
  ): Promise<void> {
    const wanted = text.trim().slice(0, 200);
    const normalized = normalizePhone(phone);

    const user = await this.prisma.user.upsert({
      where: { phone: normalized },
      create: { phone: normalized, preferredChannel: "WHATSAPP" },
      update: { preferredChannel: "WHATSAPP" },
    });
    const supplier = await this.prisma.supplierProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, companyName: state.collected.companyName },
      update: { companyName: state.collected.companyName ?? undefined },
    });
    // Префикс, а не голый текст: по нему запросы отличаются от прочих заметок
    // «с ваших слов» и собираются в список — какую категорию заводить первой.
    await this.noteAside(phone, `Просит категорию: ${wanted}`);

    await this.audit.log({
      actorType: "supplier",
      actorId: supplier.id,
      action: "requested_missing_category",
      targetType: "SupplierProfile",
      targetId: supplier.id,
    });
    this.logger.log(`${phone}: просит категорию, которой нет — «${wanted}»`);

    await this.sessions.resetToOrderFlow(phoneToChatId(normalized));
    await this.whatsapp.sendText(
      phone,
      lang === "kk"
        ? `«${wanted}» жазып алдым.\n\n` +
          "Бізде мұндай санат әзірге жоқ, сондықтан ол бойынша өтінімдер жіберілмейді — күтпеңіз. " +
          "Пайда болған сәтте сізге бірінші боп жазамыз.\n\n" +
          "Тізімдегі басқа нәрсемен де айналысатын болсаңыз — «жеткізуші» деп жазыңыз, санаттарды таңдаймыз."
        : `Записал: «${wanted}».\n\n` +
          "Такой категории у нас пока нет, поэтому заявок по ней не будет — не ждите. " +
          "Как появится, напишем вам первым.\n\n" +
          "Если возите или делаете что-то ещё из нашего списка — напишите «поставщик», подберём категории.",
    );
  }

  private async goToCategories(chatId: string, phone: string, state: OnboardingState, lang: Language): Promise<void> {
    state.step = "categories";
    state.categoryIndex = 0;
    await this.saveState(chatId, state);
    await this.askNextCategory(chatId, phone, state, lang);
  }

  /** One Yes/No button question per category (see renderCategoryQuestion) —
   * once state.categoryIndex runs past the end of the active-category list,
   * either loop back if nothing was accepted (a supplier needs at least one
   * service category) or move on to the cities step. */
  private async askNextCategory(chatId: string, phone: string, state: OnboardingState, lang: Language): Promise<void> {
    const allCategories = await this.categories.findAllActive();
    const idx = state.categoryIndex ?? 0;
    if (idx >= allCategories.length) {
      if (state.collected.categorySlugs.length === 0) {
        state.categoryIndex = 0;
        await this.saveState(chatId, state);
        await this.whatsapp.sendText(
          phone,
          lang === "kk"
            ? "Кемінде бір қызмет түрін таңдау керек. Қайта сұраймыз:\nТізімде сіздің қызметіңіз болмаса — «Басқа» батырмасын басыңыз."
            : "Нужно выбрать хотя бы одну категорию услуг. Спросим ещё раз:\nЕсли вашей услуги в списке нет — нажмите «Другое».",
        );
        await this.askNextCategory(chatId, phone, state, lang);
        return;
      }
      state.step = "cities";
      await this.saveState(chatId, state);
      await this.whatsapp.sendText(
        phone,
        lang === "kk" ? "Қай қалаларда жұмыс істейсіз? Үтір арқылы тізіп жазыңыз." : "В каких городах вы работаете? Перечислите через запятую.",
      );
      return;
    }
    const rendered = renderCategoryQuestion(allCategories[idx], lang);
    await this.whatsapp.sendButtons(phone, rendered.body, rendered.buttons!);
  }

  private async sendConfirm(phone: string, state: OnboardingState, lang: Language): Promise<void> {
    const allCategories = await this.categories.findAllActive();
    const rendered = renderOnboardingConfirm(state.collected, allCategories, lang);
    await this.whatsapp.sendButtons(phone, rendered.body, rendered.buttons!);
  }

  private async persist(phone: string, state: OnboardingState, lang: Language): Promise<void> {
    const normalized = normalizePhone(phone);
    const user = await this.prisma.user.upsert({
      where: { phone: normalized },
      create: { phone: normalized, preferredChannel: "WHATSAPP" },
      update: { preferredChannel: "WHATSAPP" },
    });

    let supplier = await this.prisma.supplierProfile.findUnique({ where: { userId: user.id } });
    if (!supplier) {
      supplier = await this.prisma.supplierProfile.create({
        data: { userId: user.id, companyName: state.collected.companyName },
      });
    } else {
      await this.prisma.supplierProfile.update({
        where: { id: supplier.id },
        data: { companyName: state.collected.companyName },
      });
    }

    await this.prisma.supplierProfile.update({
      where: { id: supplier.id },
      data: {
        // Completing this dialogue IS the opt-in — covers both a brand-new
        // profile and an operator-preloaded "cold" one the supplier just
        // registered on top of. Idempotent on re-runs: the trigger phrase
        // doubles as profile editing, and we don't want a later edit to
        // look like a fresh consent.
        confirmedAt: supplier.confirmedAt ?? new Date(),
        acceptsUrgent: state.collected.acceptsUrgent ?? true,
        // true = explicit round-the-clock opt-out; false = explicit
        // confirmation of the default window (clears any previous
        // round-the-clock choice); undefined (step somehow skipped) leaves
        // whatever was there, which for a brand-new profile is null — i.e.
        // "use the global default" per quiet-hours.util.ts.
        workingHoursStart: state.collected.roundTheClock === true ? "00:00" : state.collected.roundTheClock === false ? null : undefined,
        workingHoursEnd: state.collected.roundTheClock === true ? "23:59" : state.collected.roundTheClock === false ? null : undefined,
      },
    });

    const categoryRows = await this.prisma.category.findMany({ where: { slug: { in: state.collected.categorySlugs } } });
    await this.prisma.supplierCategory.deleteMany({ where: { supplierId: supplier.id } });
    await this.prisma.supplierCategory.createMany({
      data: categoryRows.map((c) => ({ supplierId: supplier!.id, categoryId: c.id })),
    });

    await this.prisma.serviceArea.deleteMany({ where: { supplierId: supplier.id } });
    await this.prisma.serviceArea.createMany({
      data: state.collected.cities.map((city) => ({ supplierId: supplier!.id, city })),
    });

    await this.audit.log({
      actorType: "supplier",
      actorId: supplier.id,
      action: state.isNewSupplier ? "self_register_supplier" : "self_update_supplier",
      targetType: "SupplierProfile",
      targetId: supplier.id,
    });

    await this.sessions.resetToOrderFlow(phoneToChatId(normalized));

    await this.whatsapp.sendText(
      phone,
      state.isNewSupplier
        ? lang === "kk"
          // Без «проверит модератор»: модерации в системе нет — поле
          // needsReview убрали при упрощении модели, очереди за ним не стоит.
          // Обещание, которое некому исполнить, хуже отсутствия обещания:
          // человек будет ждать проверки, которой не будет.
          ? "Дайын! Профиліңіз құрылды. Санаттарыңызда өтінім пайда болысымен бірден жібереміз.\n«профиль» — деректерді тексеру немесе өзгерту."
          : "Готово! Профиль создан. Как только появится заявка в ваших категориях — пришлём сразу.\n«профиль» — посмотреть или изменить данные."
        : lang === "kk"
          ? "Поставщик профилі жаңартылды."
          : "Профиль поставщика обновлён.",
    );

    // No-op unless this phone actually came from a PROSPECT cold-outreach
    // (see ProspectService.markConverted) — safe to call on every
    // registration/edit, not just brand-new ones, since a re-run through
    // this same trigger-phrase flow is how editing works too.
    await this.prospect.markConverted(phone, supplier.id);
  }

  private async saveState(chatId: string, state: OnboardingState): Promise<void> {
    await this.sessions.setFlow(chatId, "supplier_onboarding", { onboarding: state });
  }

  private async loadState(chatId: string): Promise<OnboardingState | null> {
    const session = await this.prisma.whatsAppSession.findUnique({ where: { chatId } });
    const raw = (session?.stateData as any)?.onboarding;
    return raw ?? null;
  }
}
