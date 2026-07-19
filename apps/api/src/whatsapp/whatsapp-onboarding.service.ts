import { Inject, Injectable, Logger } from "@nestjs/common";
import { Language } from "@ai-zayavki/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CategoriesService } from "../categories/categories.service";
import { AuditLogService } from "../common/audit-log.service";
import { normalizePhone } from "../common/phone.util";
import { WHATSAPP_PROVIDER, WhatsAppProvider } from "./whatsapp-provider.interface";
import { WhatsAppSessionService } from "./whatsapp-session.service";
import { phoneToChatId } from "./whatsapp.util";
import { renderCategoryMultiSelect, renderOnboardingConfirm, renderYesNo } from "./whatsapp-onboarding-render.util";
import { IncomingWhatsAppMessage } from "./whatsapp.types";

type Step = "company_name" | "categories" | "cities" | "urgent" | "hours" | "confirm";

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
  pendingOptions?: Record<string, string>;
  isNewSupplier: boolean;
}

// Exact-phrase match on purpose, not a substring like /поставщик/ — a client
// order such as "Ищу поставщика песка" would otherwise misfire into
// onboarding. Production would use a dedicated wa.me link with pre-filled
// text instead of guessing intent from freeform chat.
const TRIGGER_PHRASES = new Set(["поставщик", "регистрация", "стать исполнителем", "мои услуги", "я поставщик"]);

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
        : lang === "kk"
          ? "Поставщикті тіркеу. Компанияңыздың атауы немесе сізге қалай хабарласу керектігін жазыңыз."
          : "Регистрация поставщика. Как называется ваша компания или как к вам обращаться?",
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
      state.collected.companyName = msg.text.trim();
      await this.goToCategories(chatId, phone, state, lang);
      return;
    }

    if (state.step === "categories") {
      if (!token) {
        await this.whatsapp.sendText(
          phone,
          lang === "kk" ? "Жоғарыдағы тізімнен нұсқаны нөмірмен таңдаңыз." : "Выберите вариант из списка выше, отправив номер.",
        );
        return;
      }
      const [kind, ...rest] = token.split("|");
      if (kind === "sup" && rest[0] === "toggle") {
        const slug = rest[1];
        const idx = state.collected.categorySlugs.indexOf(slug);
        if (idx >= 0) state.collected.categorySlugs.splice(idx, 1);
        else state.collected.categorySlugs.push(slug);
        await this.goToCategories(chatId, phone, state, lang);
        return;
      }
      if (kind === "sup" && rest[0] === "done") {
        if (state.collected.categorySlugs.length === 0) {
          await this.whatsapp.sendText(
            phone,
            lang === "kk" ? "Жалғастыру алдында кемінде бір санатты таңдаңыз." : "Выберите хотя бы одну категорию перед тем, как продолжить.",
          );
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
    }

    if (state.step === "cities") {
      if (!msg.text?.trim()) {
        await this.whatsapp.sendText(phone, lang === "kk" ? "Қалаларды мәтінмен, үтір арқылы жазыңыз." : "Напишите города текстом, через запятую.");
        return;
      }
      state.collected.cities = msg.text
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
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

  private async goToCategories(chatId: string, phone: string, state: OnboardingState, lang: Language): Promise<void> {
    state.step = "categories";
    const allCategories = await this.categories.findAllActive();
    const rendered = renderCategoryMultiSelect(allCategories, state.collected.categorySlugs, lang);
    state.pendingOptions = rendered.pendingOptions;
    await this.saveState(chatId, state);
    await this.whatsapp.sendText(phone, rendered.body);
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
        data: { userId: user.id, companyName: state.collected.companyName, needsReview: true },
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
          ? "Дайын! Поставщик профиліңіз құрылды және модератор тексереді. Санаттарыңызда өтінімдер пайда болысымен хабарлаймыз."
          : "Готово! Ваш профиль поставщика создан и будет проверен модератором. Как только заявки в ваших категориях появятся — пришлём уведомление."
        : lang === "kk"
          ? "Поставщик профилі жаңартылды."
          : "Профиль поставщика обновлён.",
    );
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
