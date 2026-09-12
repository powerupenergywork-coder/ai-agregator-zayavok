/**
 * «Баланс» не должен читаться как требование денег.
 *
 * Бердижан, +7 776 191 9941, 9 сентября. Подключился в 16:52, взял первую
 * заявку, в 17:12 написал «Баланс» — и получил счёт на 10 000 ₸, израсходовав
 * одну заявку из пятидесяти. Ничего не сломалось: счёт печатался всегда. Но
 * человеку, у которого бесплатных заявок сорок девять, номер счёта в ответе
 * на вопрос об остатке говорит «плати», а не «вот твой остаток».
 *
 * Вторая правка из той же переписки: остаток называется одинаково в балансе и
 * в карточке профиля. Раньше профиль печатал «Уведомлений за месяц: 1 из 50»
 * (израсходовано), а баланс — «Бесплатных заявок: 49 из 50» (осталось):
 * одинаковая форма, противоположный смысл.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCompiled, buildScope } from "./lib/source.mjs";

const require = createRequire(import.meta.url);
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
require("reflect-metadata");

const failures = [];
let checked = 0;
const check = (ok, what) => {
  checked++;
  if (!ok) failures.push(what);
};

const src = readCompiled("whatsapp/whatsapp-router.service.js");

// ── Прямая просьба о счёте ─────────────────────────────────────────────────
{
  const { WANTS_INVOICE_RE } = buildScope(src, ["WANTS_INVOICE_RE"]);
  for (const [text, want] of [
    ["счёт", true],
    ["счет", true],
    ["Шот", true],
    ["хочу оплатить", true],
    ["как оплатить", true],
    ["дайте счет", true],
    ["выставите счёт", true],
    ["оплатить подписку", true],
    ["шот керек", true],
    // Не просьба: вопрос об остатке и разговор по заявке
    ["Баланс", false],
    ["сколько заявок осталось", false],
    ["сколько платят по счету заявки", false],
    ["Не берут телефон", false],
  ]) {
    checked++;
    if (WANTS_INVOICE_RE.test(text) !== want) {
      failures.push(`просьба о счёте «${text}»: распознана неверно`);
    }
  }
}

// ── Счёт печатаем только когда он к месту ──────────────────────────────────
{
  const { WhatsAppRouterService } = require(path.join(dist, "whatsapp/whatsapp-router.service.js"));
  const envMod = require(path.join(dist, "config/env.js"));
  const wasKaspi = envMod.env.kaspiBillerEnabled;
  envMod.env.kaspiBillerEnabled = true;

  function stand(status) {
    const sent = [];
    const issued = [];
    const svc = Object.create(WhatsAppRouterService.prototype);
    svc.whatsapp = { sendText: async (_p, body) => sent.push(body) };
    svc.logger = { log() {}, warn() {}, error() {} };
    svc.authOtp = { getOrCreateSupplierAuthUser: async () => ({ profileId: "p1" }) };
    // invoicePayload — единственная точка, где счёт выставляется и (при
    // включённом Tole) уходит человеку. Считаем её вызовы: счёт, которого не
    // должно быть, здесь и не появится.
    svc.billing = {
      getStatus: async () => status,
      invoicePayload: async () => {
        issued.push(1);
        return {
          invoiceNumber: "12345678",
          priceTenge: 10000,
          periodDays: 30,
          kaspiServiceName: "KerekTap",
          supportPhone: "+7 778 709 8251",
        };
      },
    };
    return { svc, sent, issued };
  }

  const fresh = {
    remainingFree: 49,
    freeQuota: 50,
    notificationsUsedThisMonth: 1,
    subscriptionActive: false,
    subscriptionExpiresAt: null,
    priceTenge: 10000,
    periodDays: 30,
  };

  // Ситуация Бердижана: одна заявка из пятидесяти
  {
    const { svc, sent, issued } = stand(fresh);
    await svc.handleBalanceCommand("+77761919941", "ru");
    const out = sent.join("\n");
    check(issued.length === 0, "счёт выставлен человеку, у которого 49 бесплатных заявок");
    check(/использовано 1 из 50/.test(out), `остаток назван иначе: «${out}»`);
    check(/«сч[её]т»/.test(out), "не сказано, как получить счёт, если человек всё же захочет платить");
  }

  // Он же, но попросил счёт словами
  {
    const { svc, issued } = stand(fresh);
    await svc.handleBalanceCommand("+77761919941", "ru", { wantsInvoice: true });
    check(issued.length === 1, "попросил счёт — и не получил его");
  }

  // Лимит на исходе: счёт нужен сам, без просьбы
  {
    const { svc, issued } = stand({ ...fresh, remainingFree: 3, notificationsUsedThisMonth: 47 });
    await svc.handleBalanceCommand("+77761919941", "ru");
    check(issued.length === 1, "бесплатные кончаются, а счёта нет — человек упрётся в лимит молча");
  }

  // Действующий подписчик продлевается заранее
  {
    const { svc, issued } = stand({
      ...fresh,
      subscriptionActive: true,
      subscriptionExpiresAt: new Date("2026-10-01"),
    });
    await svc.handleBalanceCommand("+77761919941", "ru");
    check(issued.length === 1, "подписчик не может продлиться заранее");
  }

  envMod.env.kaspiBillerEnabled = wasKaspi;
}

// ── Одна формулировка остатка в балансе и в профиле ────────────────────────
{
  const balance = /использовано \$\{[^}]*notificationsUsedThisMonth\} из \$\{[^}]*freeQuota\}/;
  check(
    /Бесплатные заявки: использовано/.test(src),
    "в балансе не та формулировка остатка",
  );
  check(
    (src.match(/Бесплатные заявки: использовано/g) ?? []).length === 2,
    "формулировка остатка встречается не в обоих местах — баланс и профиль снова разошлись",
  );
  check(
    !/Уведомлений за месяц/.test(src),
    "в профиле осталась старая формулировка «Уведомлений за месяц»",
  );
  void balance;
}

export default { name: "баланс и счёт", checked, failures };
