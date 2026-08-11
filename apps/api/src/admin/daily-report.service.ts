import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { LocalizedText } from "@ai-zayavki/shared";
import { PrismaService } from "../prisma/prisma.service";
import { env } from "../config/env";
import { WHATSAPP_PROVIDER, WhatsAppProvider } from "../whatsapp/whatsapp-provider.interface";
import { currentHourInTimezone } from "../matching/quiet-hours.util";

/**
 * Ежедневная сводка владельцу в WhatsApp.
 *
 * Смысл не в отчётности, а в том, чтобы потери были видны в тот же день.
 * Почти всё, что мы чинили за эту неделю, находилось так: кто-то присылал
 * переписку, и в ней обнаруживалась дыра. Сводка делает то же самое сама и
 * каждый вечер.
 *
 * Три раздела ровно потому, что три вещи и определяют состояние сервиса:
 * сколько пришло заявок, сколько пришло исполнителей и кого мы потеряли по
 * дороге. Последнее — самое ценное и единственное, что требует действия.
 */
@Injectable()
export class DailyReportService {
  private readonly logger = new Logger(DailyReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
  ) {}

  /**
   * Раз в час, а внутри проверяем нужный час по времени рассылки.
   *
   * Прямое расписание вида "0 15 * * *" пришлось бы держать в UTC и
   * пересчитывать руками при каждой смене DAILY_REPORT_HOUR — а ошибку в
   * таком пересчёте видно только через сутки.
   */
  @Cron("5 * * * *")
  async sendIfDue(): Promise<void> {
    if (!env.dailyReportPhone) return;
    if (currentHourInTimezone() !== env.dailyReportHour) return;
    await this.send();
  }

  /** Собрать и отправить сводку. Вынесено отдельно, чтобы можно было
   * дёрнуть руками для проверки, не дожидаясь нужного часа. */
  async send(): Promise<string> {
    const text = await this.build();
    if (env.dailyReportPhone) {
      try {
        await this.whatsapp.sendText(env.dailyReportPhone, text);
        this.logger.log(`Сводка отправлена на ${env.dailyReportPhone}`);
      } catch (err) {
        // Свободный текст доходит только внутри 24-часового окна. Если
        // владелец сегодня боту не писал, отправка не пройдёт — но сводка
        // должна остаться хотя бы в логе, иначе день пропадёт бесследно.
        this.logger.error(`Сводку отправить не удалось: ${(err as Error).message}\n${text}`);
      }
    }
    return text;
  }

  private async build(): Promise<string> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stuckSince = new Date(Date.now() - env.dailyReportStuckHours * 60 * 60 * 1000);

    const [orders, suppliers, stuckOrders, stuckOnboarding, unrecognized] = await Promise.all([
      this.prisma.order.findMany({
        where: { createdAt: { gte: since } },
        include: { category: true },
        orderBy: { number: "asc" },
      }),
      this.prisma.supplierProfile.findMany({
        where: { confirmedAt: { gte: since } },
        include: { user: true, categories: { include: { category: true } }, serviceAreas: true },
      }),
      // Заявка, в которой человек начал отвечать и остановился. DRAFT без
      // единого ответа сюда не берём: это чаще закрытая вкладка, чем потеря.
      this.prisma.order.findMany({
        where: { status: "CLARIFYING", updatedAt: { lt: stuckSince, gte: since } },
        include: { category: true },
        orderBy: { number: "asc" },
      }),
      this.prisma.whatsAppSession.findMany({
        where: { flow: "supplier_onboarding", updatedAt: { lt: stuckSince, gte: since } },
      }),
      this.prisma.whatsAppMessage.count({
        where: { unrecognized: true, createdAt: { gte: since } },
      }),
    ]);

    const L = (t: unknown) => (t as LocalizedText)?.ru ?? "—";
    const lines: string[] = [];
    const d = new Date();
    lines.push(`📊 KerekTap — сводка за сутки`);
    lines.push(`${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`);
    lines.push("");

    lines.push(`🆕 Заявки: ${orders.length}`);
    if (orders.length > 0) {
      const published = orders.filter((o) => o.status === "PUBLISHED" || o.status === "COMPLETED").length;
      lines.push(`   дошло до исполнителей: ${published}`);
      for (const o of orders.slice(0, 10)) {
        lines.push(`   №${o.number} ${L(o.category?.name)} · ${o.city ?? "город не указан"} · ${o.status}`);
      }
      if (orders.length > 10) lines.push(`   …и ещё ${orders.length - 10}`);
    }
    lines.push("");

    lines.push(`👷 Новые исполнители: ${suppliers.length}`);
    for (const s of suppliers.slice(0, 10)) {
      const cats = s.categories.map((c) => L(c.category.name)).join(", ") || "без категорий";
      const cities = s.serviceAreas.map((a) => a.city).join(", ") || "без городов";
      lines.push(`   ${s.companyName ?? s.user.phone} · ${cats} · ${cities}`);
    }
    lines.push("");

    const stuckTotal = stuckOrders.length + stuckOnboarding.length;
    lines.push(`⚠️ Зависли (молчат больше ${env.dailyReportStuckHours} ч): ${stuckTotal}`);
    for (const o of stuckOrders.slice(0, 8)) {
      lines.push(`   заявка №${o.number} ${L(o.category?.name)} — не закончена`);
    }
    for (const s of stuckOnboarding.slice(0, 8)) {
      const step = (s.stateData as { onboarding?: { step?: string } })?.onboarding?.step ?? "?";
      lines.push(`   ${s.phone} — регистрация встала на шаге «${step}»`);
    }
    lines.push("");

    // Отдельной строкой: это не потеря, а материал для доработки бота —
    // реальные формулировки, которых мы не понимаем.
    lines.push(`🤖 Бот не понял сообщений: ${unrecognized}`);

    return lines.join("\n");
  }
}
