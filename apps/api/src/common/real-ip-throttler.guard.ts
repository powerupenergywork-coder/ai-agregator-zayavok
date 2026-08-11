import { Injectable, type ExecutionContext } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";
import { env } from "../config/env";

/**
 * Счётчик запросов ведётся по адресу человека, а не по адресу nginx.
 *
 * Без этого весь мир выглядит одним клиентом: приложение стоит за прокси, и
 * `req.ip` у каждого запроса один и тот же — адрес контейнера. Первый же
 * посетитель выбрал бы общий лимит, и сайт лёг бы для всех остальных.
 *
 * Порядок источников тот же, что в kaspi-biller.controller.ts, и по той же
 * причине: X-Real-IP прокси перезаписывает своим значением и подделать его
 * снаружи не удалось, а в X-Forwarded-For настоящий адрес всегда последний —
 * что бы клиент ни прислал, прокси дописывает его в конец.
 *
 * Здесь это важнее, чем кажется: доверять левым записям X-Forwarded-For
 * значит позволить обойти лимит одной подделанной строкой заголовка.
 */
@Injectable()
export class RealIpThrottlerGuard extends ThrottlerGuard {
  /**
   * Только HTTP. Глобальный guard достаётся и WebSocket-шлюзу, а там нет ни
   * заголовков, ни req.ip — все подключения попали бы в один общий счётчик, и
   * лимит выбирался бы сообща. Считать сообщения в сокете нам не нужно: через
   * него ничего не создаётся, он только раздаёт обновления по заявке.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    return super.canActivate(context);
  }

  protected async getTracker(req: Request): Promise<string> {
    const realIp = req.headers["x-real-ip"];
    if (typeof realIp === "string" && realIp.trim()) return realIp.trim();

    const xff = req.headers["x-forwarded-for"];
    const chain = (typeof xff === "string" ? xff : "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const idx = chain.length - 1 - env.trustedProxyHops;
    return chain[idx] ?? req.ip ?? "unknown";
  }
}
