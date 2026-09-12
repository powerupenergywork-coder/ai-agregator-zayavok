/**
 * Предупреждение владельцу: исполнитель подходит к бесплатному лимиту.
 *
 * Смысл в запасе времени. Когда лимит кончится, бот предложит платить — а
 * подключить приём денег за вечер не выйдет: тариф Tole, кассир Kaspi, ключи.
 * На 12 сентября самый активный исполнитель израсходовал 6 заявок из 50, так
 * что до порога далеко, и тем важнее, чтобы сообщение пришло вовремя, а не
 * задним числом.
 *
 * Проверяется то, из-за чего такие оповещения обычно становятся бесполезными:
 * повторы (одно сообщение на месяц, а не на каждую заявку) и молчание при
 * сбое (падение оповещения не должно ронять рассылку заявки).
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
require("reflect-metadata");

const failures = [];
let checked = 0;
const check = (ok, what) => {
  checked++;
  if (!ok) failures.push(what);
};

const envMod = require(path.join(dist, "config/env.js"));
const { BillingService } = require(path.join(dist, "billing/billing.service.js"));
const { NewOrderAlertService } = require(path.join(dist, "orders/new-order-alert.service.js"));

// ── Счётчик, порог и замок ─────────────────────────────────────────────────
{
  const wasQuota = envMod.env.freeNotificationsPerMonth;
  const wasThreshold = envMod.env.quotaAlertThreshold;
  envMod.env.freeNotificationsPerMonth = 50;
  envMod.env.quotaAlertThreshold = 40;

  function stand({ used, alerted = false, alertThrows = false } = {}) {
    const alerts = [];
    const claims = [];
    const state = { used, alertedAt: alerted ? new Date() : null };
    const svc = Object.create(BillingService.prototype);
    svc.logger = { log() {}, warn() {}, error() {} };
    svc.prisma = {
      supplierProfile: {
        findUniqueOrThrow: async () => ({
          id: "s1",
          companyName: "Женис",
          notificationsUsedThisMonth: state.used,
          subscription: null,
          user: { phone: "+77011234567" },
        }),
        updateMany: async ({ where, data }) => {
          // Списание квоты
          if (data?.notificationsUsedThisMonth?.increment) {
            if (state.used >= where.notificationsUsedThisMonth.lt) return { count: 0 };
            state.used += 1;
            return { count: 1 };
          }
          // Заявка на право предупредить: оба условия — часть замка
          claims.push(where);
          const free = where.quotaAlertAt === null && state.alertedAt === null;
          const overThreshold = state.used >= where.notificationsUsedThisMonth.gte;
          if (!free || !overThreshold) return { count: 0 };
          state.alertedAt = data.quotaAlertAt;
          return { count: 1 };
        },
      },
    };
    svc.ownerAlert = {
      alertQuotaNearLimit: async (opts) => {
        if (alertThrows) throw new Error("владелец недоступен");
        alerts.push(opts);
      },
    };
    return { svc, alerts, state, claims };
  }

  // Далеко от порога — молчим
  {
    const { svc, alerts, state } = stand({ used: 6 });
    check((await svc.checkAndConsumeQuota("s1")) === true, "заявка не списалась");
    check(state.used === 7, "счётчик не увеличился");
    check(alerts.length === 0, "предупредили владельца на седьмой заявке из пятидесяти");
  }

  // Ровно на пороге — говорим
  {
    const { svc, alerts } = stand({ used: 39 });
    await svc.checkAndConsumeQuota("s1");
    check(alerts.length === 1, "сороковая заявка прошла молча");
    check(alerts[0]?.used === 40, `в сообщении ${alerts[0]?.used} заявок вместо 40`);
    check(alerts[0]?.quota === 50, "в сообщении не тот размер лимита");
    check(alerts[0]?.companyName === "Женис", "не сказано, о ком речь");
    check(alerts[0]?.phone === "+77011234567", "нет телефона исполнителя — некому звонить");
  }

  // Следующие заявки того же месяца — молчим
  {
    const { svc, alerts } = stand({ used: 39 });
    await svc.checkAndConsumeQuota("s1");
    await svc.checkAndConsumeQuota("s1");
    await svc.checkAndConsumeQuota("s1");
    check(alerts.length === 1, `владельцу ушло ${alerts.length} сообщений вместо одного`);
  }

  // Уже предупреждали в этом месяце — второй раз не повторяем
  {
    const { svc, alerts } = stand({ used: 44, alerted: true });
    await svc.checkAndConsumeQuota("s1");
    check(alerts.length === 0, "повторное предупреждение в том же месяце");
  }

  // Замок — в условии запроса, а не в проверке перед ним
  {
    const { svc, claims } = stand({ used: 39 });
    await svc.checkAndConsumeQuota("s1");
    const claim = claims.find((w) => "quotaAlertAt" in w);
    check(!!claim, "право предупредить не запрашивалось условным обновлением");
    check(claim?.quotaAlertAt === null, "в условии нет проверки «ещё не предупреждали»");
    check(claim?.notificationsUsedThisMonth?.gte === 40, "в условии нет порога");
  }

  // Лимит исчерпан — заявка не списывается, но и падать некуда
  {
    const { svc, alerts } = stand({ used: 50 });
    check((await svc.checkAndConsumeQuota("s1")) === false, "заявка списалась сверх лимита");
    check(alerts.length === 0, "предупреждение ушло на несписанной заявке");
  }

  // Оповещение упало — рассылка заявки продолжается
  {
    const { svc } = stand({ used: 39, alertThrows: true });
    let ok = null;
    try {
      ok = await svc.checkAndConsumeQuota("s1");
    } catch {
      ok = "упало";
    }
    check(ok === true, "сбой оповещения владельцу остановил выдачу заявки исполнителю");
  }

  // Порог 0 выключает оповещение целиком
  {
    envMod.env.quotaAlertThreshold = 0;
    const { svc, alerts } = stand({ used: 49 });
    await svc.checkAndConsumeQuota("s1");
    check(alerts.length === 0, "нулевой порог не выключил оповещение");
    envMod.env.quotaAlertThreshold = 40;
  }

  envMod.env.freeNotificationsPerMonth = wasQuota;
  envMod.env.quotaAlertThreshold = wasThreshold;
}

// ── Первое число: отметка снимается вместе со счётчиком ────────────────────
{
  // Без сброса предупреждение об исполнителе, дошедшем до порога однажды,
  // больше не повторилось бы никогда: замок «уже предупреждали» вечен.
  const updates = [];
  const svc = Object.create(BillingService.prototype);
  svc.logger = { log() {}, warn() {}, error() {} };
  svc.prisma = {
    supplierProfile: {
      updateMany: async (args) => {
        updates.push(args);
        return { count: 3 };
      },
    },
  };
  await svc.resetMonthlyQuotas();
  check(updates.length === 1, "месячный сброс не выполнился");
  check(updates[0]?.data?.notificationsUsedThisMonth === 0, "счётчик заявок не обнулён");
  check(
    updates[0]?.data?.quotaAlertAt === null,
    "отметка о предупреждении не снята — в следующем месяце владелец ничего не узнает",
  );
}

// ── Текст владельцу ────────────────────────────────────────────────────────
{
  const wasKaspi = envMod.env.kaspiBillerEnabled;
  const wasTole = envMod.env.toleEnabled;
  const wasKey = envMod.env.toleApiKey;
  const wasPhone = envMod.env.newOrderAlertPhone;
  envMod.env.newOrderAlertPhone = "+77787098251";

  function stand() {
    const sent = [];
    const svc = Object.create(NewOrderAlertService.prototype);
    svc.logger = { log() {}, warn() {}, error() {} };
    svc.whatsapp = { sendText: async (_p, body) => sent.push(body) };
    return { svc, sent };
  }

  // Принимать деньги нечем — об этом надо сказать прямо
  {
    envMod.env.kaspiBillerEnabled = false;
    envMod.env.toleEnabled = false;
    envMod.env.toleApiKey = "";
    const { svc, sent } = stand();
    await svc.alertQuotaNearLimit({ companyName: "Женис", phone: "+77011234567", used: 40, quota: 50 });
    const out = sent.join("\n");
    check(/Женис/.test(out), "в сообщении нет имени исполнителя");
    check(/40 из 50/.test(out), `не названы цифры: «${out}»`);
    check(/\+77011234567/.test(out), "нет телефона");
    check(/нечем/i.test(out), "не сказано, что принять оплату сейчас нечем");
  }

  // Счета включены — тон другой
  {
    envMod.env.toleEnabled = true;
    envMod.env.toleApiKey = "tole_sk_live_v1_xxx";
    const { svc, sent } = stand();
    await svc.alertQuotaNearLimit({ companyName: null, phone: "+77011234567", used: 41, quota: 50 });
    const out = sent.join("\n");
    check(/автоматически/.test(out), "не сказано, что счёт уйдёт сам");
    check(!/нечем/i.test(out), "пугаем отсутствием оплаты, хотя она подключена");
    check(/\+77011234567/.test(out), "без названия компании должен остаться хотя бы телефон");
  }

  // Некому слать — молчим, а не падаем
  {
    envMod.env.newOrderAlertPhone = "";
    const wasDaily = envMod.env.dailyReportPhone;
    envMod.env.dailyReportPhone = "";
    const { svc, sent } = stand();
    await svc.alertQuotaNearLimit({ companyName: "Женис", phone: "+77011234567", used: 40, quota: 50 });
    check(sent.length === 0, "сообщение ушло в пустоту");
    envMod.env.dailyReportPhone = wasDaily;
  }

  envMod.env.kaspiBillerEnabled = wasKaspi;
  envMod.env.toleEnabled = wasTole;
  envMod.env.toleApiKey = wasKey;
  envMod.env.newOrderAlertPhone = wasPhone;
}

export default { name: "лимит на исходе", checked, failures };
