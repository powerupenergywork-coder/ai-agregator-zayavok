import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Короткий код вместо длинного идентификатора клика.
 *
 * Google отдаёт gclid только в адресе посадочной страницы, а семь заявок из
 * десяти оформляются в WhatsApp — туда адрес не переносится. Единственный
 * канал, по которому что-то доезжает из браузера в чат, это предзаполненный
 * текст сообщения, и он виден человеку. Значит код должен быть коротким и не
 * выглядеть мусором в его собственной реплике.
 *
 * Без цифр 0/1 и букв I/O/L: человек может набрать код руками с чужого
 * экрана, и «0» против «O» здесь стоит потерянной атрибуции.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const TOKEN_LENGTH = 5;

/**
 * Сколько код ждёт своего сообщения.
 *
 * Человек нажимает кнопку и попадает в WhatsApp сразу же — минуты, не дни. Но
 * бывает, что чат открывают и пишут вечером, поэтому неделя. Дольше держать
 * незачем: код из прошлого месяца принесёт атрибуцию, которой не было.
 */
const TOKEN_TTL_DAYS = 7;

@Injectable()
export class AdClickService {
  private readonly logger = new Logger(AdClickService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Запомнить клик и выдать код для предзаполненного текста.
   *
   * Повтор кода практически невозможен (31⁵ — почти 29 миллионов), но если он
   * случится, вставка упадёт на уникальном индексе. Пробуем ещё раз, а не
   * отдаём ошибку: человеку в этот момент нужна кнопка в WhatsApp, а не
   * сообщение о сбое.
   */
  async issue(clickId: string, source: string, params?: Record<string, string>): Promise<string | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = this.randomToken();
      try {
        await this.prisma.adClick.create({
          data: { token, clickId: clickId.slice(0, 200), source, params: params as object | undefined },
        });
        return token;
      } catch {
        // Столкновение кодов — берём другой.
      }
    }
    this.logger.warn("Не удалось выдать код клика: три столкновения подряд");
    return null;
  }

  /**
   * Обменять код обратно на источник.
   *
   * Возвращает то, что ждёт WhatsAppSessionService.adAttribution: имя
   * источника и метки. Просроченный или неизвестный код — молча null: человек
   * ничего не должен заметить, он просто пишет заявку.
   */
  async redeem(token: string): Promise<{ source: string; params: Record<string, string> } | null> {
    try {
      const click = await this.prisma.adClick.findUnique({ where: { token: token.toUpperCase() } });
      if (!click) return null;
      const ageDays = (Date.now() - click.createdAt.getTime()) / (24 * 60 * 60 * 1000);
      if (ageDays > TOKEN_TTL_DAYS) return null;

      // Отметка о применении, а не удаление: по неиспользованным кодам видно,
      // сколько кликов до разговора вообще не дошло.
      if (!click.usedAt) {
        await this.prisma.adClick.update({ where: { id: click.id }, data: { usedAt: new Date() } });
      }

      const extra = (click.params ?? {}) as Record<string, unknown>;
      const params: Record<string, string> = { gclid: click.clickId };
      for (const [key, value] of Object.entries(extra)) {
        if (typeof value === "string" && value) params[key] = value.slice(0, 120);
      }
      return { source: click.source, params };
    } catch (err) {
      this.logger.warn(`Не удалось разобрать код клика ${token}: ${(err as Error).message}`);
      return null;
    }
  }

  private randomToken(): string {
    let out = "";
    for (let i = 0; i < TOKEN_LENGTH; i++) {
      out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return out;
  }
}
