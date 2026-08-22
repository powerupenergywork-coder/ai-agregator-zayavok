import { Inject, Injectable, Logger } from "@nestjs/common";
import { LocalizedText } from "@ai-zayavki/shared";
import { PrismaService } from "../prisma/prisma.service";
import { env } from "../config/env";
import { WHATSAPP_PROVIDER, WhatsAppProvider } from "../whatsapp/whatsapp-provider.interface";

/**
 * Сообщение владельцу в момент, когда человек написал первое сообщение.
 *
 * Не вместо бота, а рядом с ним: бот доводит заявку сам, как и раньше.
 * Смысл в том, что заявки 102, 103 и 104 умерли на первом-втором вопросе и
 * стали видны только в вечерней сводке — когда звонить уже поздно. Сводка
 * показывает вчерашние потери, а нужно видеть сегодняшние, пока человек ещё
 * держит телефон в руке.
 *
 * Срабатывает на ПЕРВОЙ реплике клиента, а не на публикации: до публикации
 * не дошла ни одна из трёх.
 */
@Injectable()
export class NewOrderAlertService {
  private readonly logger = new Logger(NewOrderAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
  ) {}

  private get recipient(): string {
    return env.newOrderAlertPhone || env.dailyReportPhone;
  }

  /**
   * Ошибка здесь не должна касаться клиента: он оформляет заявку и не имеет
   * отношения к тому, дошло ли уведомление до владельца. Поэтому весь метод
   * под try/catch, а текст при неудаче остаётся в логе.
   */
  async alert(orderId: string, firstMessage: string): Promise<void> {
    if (!this.recipient) return;
    try {
      // Сначала шаблоном: свободный текст доходит до владельца только внутри
      // 24-часового окна, то есть если он сегодня сам писал боту. Оповещение
      // о заявке, которое приходит через раз, бесполезно — а именно за этим
      // его и заводили.
      const parts = await this.buildParams(orderId, firstMessage);
      if (parts) {
        await this.whatsapp.sendTemplate(this.recipient, "owner_new_order_ru", "ru", parts);
        return;
      }
      const text = await this.build(orderId, firstMessage);
      await this.whatsapp.sendText(this.recipient, text);
    } catch (err) {
      // Свободный текст доходит только внутри 24-часового окна WhatsApp: если
      // владелец сегодня боту не писал, Meta отклонит отправку. Такое же
      // ограничение у вечерней сводки — см. DailyReportService.send().
      this.logger.error(`Оповещение о новой заявке не ушло: ${(err as Error).message}`);
    }
  }

  /**
   * Разослали, а никто не прочитал.
   *
   * Это не про клиента, а про нас: одиннадцать уведомлений и ноль прочтений
   * означают, что список исполнителей мёртвый, а не что заявка плохая. Клиент
   * об этом узнать не может, и кроме владельца среагировать некому.
   */
  async alertNoViews(orderId: string, orderNumber: number, sent: number): Promise<void> {
    if (!this.recipient) return;
    try {
      await this.whatsapp.sendText(
        this.recipient,
        `⚠️ Заявку №${orderNumber} не прочитал ни один исполнитель (разослана ${sent}).` + "\n\n" +
          "Сообщения доставлены, но ни одно не открыто. Стоит позвонить исполнителям вручную — " +
          "клиент ждёт звонков и пока их не будет.",
      );
    } catch (err) {
      this.logger.error(`Оповещение о нуле просмотров не ушло: ${(err as Error).message}`);
    }
  }

  /**
   * Пять подстановок утверждённого шаблона owner_new_order_ru:
   * номер, категория, город, телефон клиента, первая фраза.
   *
   * Пусто — если заявку не нашли: тогда уходит свободный текст, он хотя бы
   * попадёт в лог.
   */
  private async buildParams(orderId: string, firstMessage: string): Promise<string[] | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { category: true, client: { include: { user: true } } },
    });
    if (!order) return null;
    const sessionPhone = await this.prisma.whatsAppSession
      .findFirst({ where: { currentOrderId: orderId }, select: { phone: true } })
      .then((r) => r?.phone);
    const phone = order.client?.user.phone ?? sessionPhone ?? "с сайта, телефона пока нет";
    // Переводы строк в подстановке Мета отклоняет — держим всё в одну строку.
    const said = firstMessage.replace(/\s+/g, " ").slice(0, 200);
    return [
      String(order.number),
      order.category ? (order.category.name as unknown as LocalizedText).ru : "категория не определена",
      order.city ?? "город не указан",
      phone,
      said,
    ];
  }

  private async build(orderId: string, firstMessage: string): Promise<string> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { category: true, client: { include: { user: true } } },
    });
    if (!order) return `🆕 Новая заявка (${orderId})\n\n«${firstMessage}»`;

    // Телефон у черновика из WhatsApp появляется только при публикации —
    // clientId до этого пустой. Но чат с этим человеком уже идёт, и номер
    // лежит в сессии, привязанной к заявке. Для веб-заявок сессии нет, и это
    // честно видно в тексте.
    const sessionPhone = await this.prisma.whatsAppSession
      .findFirst({ where: { currentOrderId: orderId }, select: { phone: true } })
      .then((s) => s?.phone);
    const phone = order.client?.user.phone ?? sessionPhone ?? null;

    const lines = [`🆕 Заявка №${order.number}${order.city ? ` · ${order.city}` : ""}`];
    if (order.category) lines.push((order.category.name as unknown as LocalizedText).ru);
    lines.push("");
    lines.push(`Написал: «${firstMessage.slice(0, 300)}»`);
    lines.push("");
    if (phone) {
      lines.push(`Клиент: ${phone}`);
      lines.push(`Позвонить: https://wa.me/${phone.replace(/\D/g, "")}`);
    } else {
      lines.push("Заявка с сайта — телефон появится при подтверждении.");
    }
    lines.push("");
    lines.push("Бот ведёт оформление сам. Звоните, если видите, что человек застрял.");
    return lines.join("\n");
  }
}
