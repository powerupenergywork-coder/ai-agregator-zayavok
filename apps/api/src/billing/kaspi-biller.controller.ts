import { Controller, Get, Headers, Logger, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { env } from "../config/env";
import { KaspiBillerService, KaspiResponse, KaspiResult } from "./kaspi-biller.service";

/**
 * Endpoint, который дёргает Kaspi. Адрес отдаётся банку при подключении
 * услуги: https://kerektap.kz/api/kaspi/pay
 *
 * Всегда HTTP 200 и всегда тело с кодом в result — банк читает именно его.
 * Ответ 4xx/5xx для протокола не предусмотрен: с точки зрения Kaspi это обрыв
 * связи, и запрос будет повторён.
 *
 * Отвечать надо быстрее 15 секунд, иначе банк рвёт соединение по таймауту.
 * Ни один путь здесь не ходит наружу и не ждёт очередей, поэтому запас есть.
 */
@Controller("kaspi")
export class KaspiBillerController {
  private readonly logger = new Logger(KaspiBillerController.name);

  constructor(private readonly biller: KaspiBillerService) {}

  /**
   * Адрес клиента через нашу цепочку прокси.
   *
   * X-Forwarded-For заполняется слева направо: первым идёт исходный клиент,
   * дальше каждый прокси дописывает того, от кого получил запрос. Перед
   * контейнером стоит nginx compose, перед ним nginx хоста — то есть справа
   * лежат ровно trustedProxyHops наших собственных адресов, а нужный нам
   * последний из тех, что левее.
   *
   * Берём именно эту позицию, а не первую: первую подделывает кто угодно,
   * просто прислав свой заголовок X-Forwarded-For, и тогда проверка по IP
   * перестаёт что-либо значить. Число прыжков не угадано — проверяется через
   * /kaspi/whoami на живом сервере.
   */
  private clientIp(req: Request, xff: string | undefined): string {
    const chain = (xff ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const idx = chain.length - 1 - env.trustedProxyHops;
    return chain[idx] ?? req.socket.remoteAddress ?? "";
  }

  private allowed(ip: string): boolean {
    // ::ffff:1.2.3.4 — тот же адрес, записанный в IPv6-нотации.
    const bare = ip.replace(/^::ffff:/, "");
    return env.kaspiAllowedIps.includes(bare);
  }

  /**
   * Диагностика цепочки прокси. Нужна ровно один раз — чтобы подобрать
   * TRUSTED_PROXY_HOPS по факту, а не по предположению о том, сколько
   * прокси стоит перед приложением. Ничего не меняет и ничего не выдаёт,
   * кроме адресов самого спрашивающего.
   */
  @Get("whoami")
  whoami(@Req() req: Request, @Headers("x-forwarded-for") xff: string | undefined) {
    return {
      xForwardedFor: xff ?? null,
      xRealIp: req.headers["x-real-ip"] ?? null,
      socket: req.socket.remoteAddress ?? null,
      hops: env.trustedProxyHops,
      resolved: this.clientIp(req, xff),
      allowed: this.allowed(this.clientIp(req, xff)),
    };
  }

  @Get("pay")
  async handle(
    @Req() req: Request,
    @Headers("x-forwarded-for") xff: string | undefined,
    @Query("command") command: string | undefined,
    @Query("txn_id") txnId: string | undefined,
    @Query("account") account: string | undefined,
    @Query("sum") sum: string | undefined,
    @Query("txn_date") txnDate: string | undefined,
    @Query("data1") data1: string | undefined,
  ): Promise<KaspiResponse> {
    const ip = this.clientIp(req, xff);
    const id = txnId ?? "";

    // В протоколе нет ни подписи, ни ключа — список адресов это вся защита,
    // какая есть. Без неё любой GET-запрос выдаёт себе платную подписку.
    if (!this.allowed(ip)) {
      this.logger.warn(`Запрос с чужого адреса ${ip} (${command ?? "?"} ${id}) — отклонён`);
      return { txn_id: id, result: KaspiResult.ERROR, comment: "Доступ запрещён" };
    }
    // Секрет проверяем, только если он задан: банк передаёт постоянное
    // значение в data1, если согласился его настроить. Защита сверх адресов.
    if (env.kaspiSharedSecret && data1 !== env.kaspiSharedSecret) {
      this.logger.warn(`Неверный data1 в запросе ${id} с ${ip} — отклонён`);
      return { txn_id: id, result: KaspiResult.ERROR, comment: "Доступ запрещён" };
    }
    if (!id || !account) {
      return { txn_id: id, result: KaspiResult.ERROR, comment: "Не переданы txn_id или account" };
    }

    try {
      if (command === "check") return await this.biller.check(id, account);
      if (command === "pay") return await this.biller.pay(id, account, sum ?? "0", txnDate);
      return { txn_id: id, result: KaspiResult.ERROR, comment: "Неизвестная команда" };
    } catch (err) {
      // Наружу — код 5 и 200: исключение, ушедшее в HTTP 500, банк считает
      // обрывом и повторит запрос, а повтор упадёт ровно так же.
      this.logger.error(`Ошибка обработки ${command} ${id}: ${(err as Error).message}`);
      return { txn_id: id, result: KaspiResult.ERROR, comment: "Внутренняя ошибка" };
    }
  }
}
