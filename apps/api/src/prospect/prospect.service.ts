import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { CategoryField, LocalizedText } from "@ai-zayavki/shared";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { MatchingService } from "../matching/matching.service";
import { AuditLogService } from "../common/audit-log.service";
import { normalizePhone } from "../common/phone.util";
import { safeSummary } from "../matching/matching-message.util";
import { env } from "../config/env";

// PROSPECT-онбординг (прогрев поставщиков) — см. ТЗ_прогрев_поставщиков_v2.
// Не дублирует WhatsAppOnboardingService's FSM: this service only owns the
// ProspectContact lifecycle (sent -> responded -> converted, or -> ignored)
// and the one-off cold-outreach send. The actual registration conversation
// is the exact same flow a trigger-phrase self-registration goes through —
// see WhatsAppRouterService's "prospect|interested|<lang>" token handling
// and WhatsAppOnboardingService.persist()'s call into markConverted().
@Injectable()
export class ProspectService {
  private readonly logger = new Logger(ProspectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly matching: MatchingService,
    private readonly audit: AuditLogService,
  ) {}

  async initiateColdOutreach(rawPhone: string, orderId: string, actor: { type: "admin" | "operator"; id: string }) {
    const phone = normalizePhone(rawPhone);

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { category: true, dispatchWaves: true },
    });
    if (!order) throw new NotFoundException("Заявка не найдена");
    if (order.status !== "PUBLISHED") {
      throw new BadRequestException("Заявка должна быть в статусе PUBLISHED для прогрева поставщиков");
    }

    const settings = await this.prisma.dispatchSettings.findFirst();
    const waveSize = settings?.waveSize ?? env.dispatchWaveSize;
    const notifiedCount = new Set(order.dispatchWaves.flatMap((w) => w.supplierIds as string[])).size;
    if (notifiedCount >= waveSize) {
      throw new BadRequestException("По этой заявке уже набралась волна откликов — выберите другую заявку");
    }

    const existingUser = await this.prisma.user.findUnique({ where: { phone }, include: { supplierProfile: true } });
    if (existingUser?.supplierProfile) {
      throw new BadRequestException("Этот номер уже зарегистрирован как поставщик");
    }

    const cooldownMs = env.prospectResendCooldownDays * 24 * 60 * 60 * 1000;
    const lastContact = await this.prisma.prospectContact.findFirst({
      where: { phone },
      orderBy: { firstContactedAt: "desc" },
    });
    if (lastContact && Date.now() - lastContact.firstContactedAt.getTime() < cooldownMs) {
      throw new BadRequestException(
        `Этому номеру уже отправляли холодное сообщение менее ${env.prospectResendCooldownDays} дней назад`,
      );
    }

    if (!order.categoryId || !order.category) throw new BadRequestException("У заявки не определена категория");
    const categoryFields = (order.category.fields as unknown as CategoryField[]) ?? [];
    const categoryName = order.category.name as unknown as LocalizedText;

    await this.notifications.send({
      event: "prospect_outreach",
      channel: "WHATSAPP",
      payload: {
        categoryRu: categoryName.ru,
        categoryKk: categoryName.kk,
        city: order.city ?? "",
        summaryRu: safeSummary(order.fieldsData, categoryFields, "ru"),
        summaryKk: safeSummary(order.fieldsData, categoryFields, "kk"),
      },
      recipientPhone: phone,
      orderId,
      buttons: [
        { id: "prospect|interested|ru", text: "Интересно" },
        { id: "prospect|interested|kk", text: "Қызығамын" },
      ],
    });

    const contact = await this.prisma.prospectContact.create({
      data: { phone, orderId, status: "sent" },
    });

    await this.audit.log({
      actorType: actor.type,
      actorId: actor.id,
      action: "prospect_initiate_cold_outreach",
      targetType: "ProspectContact",
      targetId: contact.id,
      metadata: { phone, orderId },
    });

    return contact;
  }

  /** Called from WhatsAppRouterService when a "prospect|interested|<lang>"
   * button tap arrives — before onboarding.start() runs. Picks the most
   * recent not-yet-resolved contact for this phone; if there is none (stale
   * button, already handled), returns null and the caller just proceeds to
   * start onboarding anyway — a button tap is still real user intent even
   * if we lost track of which outreach prompted it. */
  async markResponded(rawPhone: string) {
    const phone = normalizePhone(rawPhone);
    const contact = await this.prisma.prospectContact.findFirst({
      where: { phone, status: "sent" },
      orderBy: { firstContactedAt: "desc" },
    });
    if (!contact) return null;
    return this.prisma.prospectContact.update({
      where: { id: contact.id },
      data: { status: "responded", respondedAt: new Date() },
    });
  }

  /** Called from WhatsAppOnboardingService.persist() right after a
   * SupplierProfile is created/updated with needsReview: true. Marks the
   * funnel converted and triggers the one-off targeted notify for the
   * anchor order (or its best replacement) — see
   * MatchingService.notifyConvertedProspect(). No-ops silently if this
   * phone was never actually a PROSPECT (normal trigger-phrase
   * self-registration, most of the time). */
  async markConverted(rawPhone: string, supplierId: string): Promise<void> {
    const phone = normalizePhone(rawPhone);
    const contact = await this.prisma.prospectContact.findFirst({
      where: { phone, status: { in: ["sent", "responded"] } },
      orderBy: { firstContactedAt: "desc" },
    });
    if (!contact) return;

    await this.prisma.prospectContact.update({
      where: { id: contact.id },
      data: { status: "converted", convertedAt: new Date() },
    });
    await this.matching.notifyConvertedProspect(supplierId, contact.orderId);
  }

  async listProspects(filters: { status?: string; city?: string; categorySlug?: string }) {
    const rows = await this.prisma.prospectContact.findMany({
      where: {
        status: filters.status,
        order: {
          ...(filters.city ? { city: { equals: filters.city, mode: "insensitive" } } : {}),
          ...(filters.categorySlug ? { category: { slug: filters.categorySlug } } : {}),
        },
      },
      include: { order: { include: { category: true } } },
      orderBy: { firstContactedAt: "desc" },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      phone: r.phone,
      status: r.status,
      leadSource: r.leadSource,
      firstContactedAt: r.firstContactedAt,
      respondedAt: r.respondedAt,
      convertedAt: r.convertedAt,
      orderNumber: r.order.number,
      categoryName: r.order.category ? (r.order.category.name as unknown as LocalizedText).ru : null,
      city: r.order.city,
    }));
  }

  async getFunnel() {
    const [sent, responded, converted] = await Promise.all([
      this.prisma.prospectContact.count(),
      this.prisma.prospectContact.count({ where: { status: { in: ["responded", "converted"] } } }),
      this.prisma.prospectContact.count({ where: { status: "converted" } }),
    ]);
    const convertedContacts = await this.prisma.prospectContact.findMany({
      where: { status: "converted" },
      select: { phone: true },
    });
    const active = await this.prisma.supplierProfile.count({
      where: {
        needsReview: false,
        isBlocked: false,
        user: { phone: { in: convertedContacts.map((c) => c.phone) } },
      },
    });
    return { sent, responded, registered: converted, active };
  }

  /** Daily sweep — a PROSPECT who never taps the button shouldn't sit in
   * "sent" forever; see ТЗ_прогрев_поставщиков_v2 п.4.1/8. Operators can
   * still mark one ignored manually earlier via the admin list. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async markStaleAsIgnored(): Promise<void> {
    const cutoff = new Date(Date.now() - env.prospectIgnoreTimeoutDays * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.prospectContact.updateMany({
      where: { status: { in: ["sent", "responded"] }, firstContactedAt: { lt: cutoff } },
      data: { status: "ignored" },
    });
    if (count > 0) this.logger.log(`Marked ${count} stale PROSPECT contact(s) as ignored`);
  }
}
