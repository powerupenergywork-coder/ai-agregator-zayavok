import { Controller, Get, Headers, Logger, Query, Req, Res } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { env } from "../config/env";
import { KaspiBillerService, KaspiResponse, KaspiResult } from "./kaspi-biller.service";
import { toKaspiXml } from "./kaspi-response.util";

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
/**
 * Лимит запросов снят: чужие сюда и так не проходят — маршрут закрыт списком
 * адресов Kaspi (KASPI_ALLOWED_IPS). А банку 429 отдавать нельзя: для их
 * протокола это обрыв связи, они повторят запрос, и человек у кассы увидит
 * ошибку оплаты.
 */
@SkipThrottle()
@Controller("kaspi")
export class KaspiBillerController {
  private readonly logger = new Logger(KaspiBillerController.name);

  constructor(private readonly biller: KaspiBillerService) {}

  /**
   * Адрес клиента через нашу цепочку прокси.
   *
   * Порядок источников подобран опытом на боевом сервере, а не рассуждением,
   * и это принципиально: в протоколе нет подписи, поэтому адрес — вся защита,
   * и ошибка здесь означает, что подписку себе выпишет кто угодно одним
   * curl-запросом. Ровно это и обнаружилось при первой проверке: с расчётом
   * «отступить от конца на число своих прокси» подделанный заголовок
   * «X-Forwarded-For: 194.187.247.152, 1.2.3.4» проходил как адрес Kaspi.
   *
   * Что показал опыт (GET /kaspi/whoami с подделанными заголовками):
   *
   * — X-Real-IP прокси перезаписывает своим значением, подделать его снаружи
   *   не удалось. Это самый надёжный источник, поэтому он первый.
   * — В X-Forwarded-For настоящий адрес всегда оказывается ПОСЛЕДНИМ: что бы
   *   клиент ни прислал, прокси дописывает его в конец. Левые записи
   *   полностью под контролем клиента и доверять им нельзя ни при каком
   *   числе прыжков.
   *
   * trustedProxyHops оставлен на случай, если перед приложением появится ещё
   * один прокси: тогда настоящий адрес сместится от конца на столько же.
   * По умолчанию 0 — сегодня своих записей в заголовке нет.
   */
  private clientIp(req: Request, xff: string | undefined): string {
    const realIp = req.headers["x-real-ip"];
    if (typeof realIp === "string" && realIp.trim()) return realIp.trim();
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

  /**
   * XML или JSON. Протокол разрешает оба и ведёт с XML, а что читает их
   * парсер на самом деле, снаружи не видно — поэтому формат выбирается, а не
   * зашит: явным параметром, заголовком Accept или настройкой по умолчанию.
   * Это ровно тот класс расхождений, из-за которых интеграцию потом
   * «подкручивают» на тестах.
   */
  private wantsXml(format: string | undefined, accept: string | undefined): boolean {
    if (format === "xml") return true;
    if (format === "json") return false;
    if (accept?.includes("xml")) return true;
    return env.kaspiResponseFormat === "xml";
  }

  @Get("pay")
  async handle(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers("x-forwarded-for") xff: string | undefined,
    @Headers("accept") accept: string | undefined,
    @Query("command") command: string | undefined,
    @Query("txn_id") txnId: string | undefined,
    @Query("account") account: string | undefined,
    @Query("sum") sum: string | undefined,
    @Query("txn_date") txnDate: string | undefined,
    @Query("data1") data1: string | undefined,
    @Query("format") format: string | undefined,
  ): Promise<KaspiResponse | string> {
    const ip = this.clientIp(req, xff);
    const id = txnId ?? "";
    const reply = (r: KaspiResponse): KaspiResponse | string => {
      if (!this.wantsXml(format, accept)) return r;
      res.type("application/xml; charset=utf-8");
      return toKaspiXml(r);
    };

    // В протоколе нет ни подписи, ни ключа — список адресов это вся защита,
    // какая есть. Без неё любой GET-запрос выдаёт себе платную подписку.
    if (!this.allowed(ip)) {
      this.logger.warn(`Запрос с чужого адреса ${ip} (${command ?? "?"} ${id}) — отклонён`);
      return reply({ txn_id: id, result: KaspiResult.ERROR, comment: "Доступ запрещён" });
    }
    // Секрет проверяем, только если он задан: банк передаёт постоянное
    // значение в data1, если согласился его настроить. Защита сверх адресов.
    if (env.kaspiSharedSecret && data1 !== env.kaspiSharedSecret) {
      this.logger.warn(`Неверный data1 в запросе ${id} с ${ip} — отклонён`);
      return reply({ txn_id: id, result: KaspiResult.ERROR, comment: "Доступ запрещён" });
    }
    if (!account) {
      return reply({ txn_id: id, result: KaspiResult.ERROR, comment: "Не передан account" });
    }

    try {
      // txn_id для check не обязателен. По протоколу банк присылает его
      // всегда, но проверяют этот адрес и руками из браузера — а отказ на
      // такой запрос читается как «сервис не работает», хотя дело в одном
      // недостающем параметре. check ничего не меняет, поэтому терять на нём
      // нечего. Для pay он остаётся обязательным: это ключ идемпотентности,
      // без него повторный платёж нечем отличить от нового.
      if (command === "check") return reply(await this.biller.check(id, account));
      if (command === "pay") {
        if (!id) {
          return reply({ txn_id: "", result: KaspiResult.ERROR, comment: "Не передан txn_id" });
        }
        return reply(await this.biller.pay(id, account, sum ?? "0", txnDate));
      }
      return reply({ txn_id: id, result: KaspiResult.ERROR, comment: "Неизвестная команда" });
    } catch (err) {
      // Наружу — код 5 и 200: исключение, ушедшее в HTTP 500, банк считает
      // обрывом и повторит запрос, а повтор упадёт ровно так же.
      this.logger.error(`Ошибка обработки ${command} ${id}: ${(err as Error).message}`);
      return reply({ txn_id: id, result: KaspiResult.ERROR, comment: "Внутренняя ошибка" });
    }
  }
}
