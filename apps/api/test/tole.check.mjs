/**
 * Счета через Tole — оплата Kaspi, пока банк молчит по протоколу биллера.
 *
 * Биллер написан, включён и за три недели не получил от Kaspi ни одного
 * запроса: счета, которые бот уже слал исполнителям, оплатить негде. Tole
 * выставляет тот же счёт Kaspi через роль «Кассир» и не требует договора.
 *
 * Проверяется то, что стоит денег, если сломается:
 * — ключ идемпотентности выведен из номера счёта, а не случайный (иначе два
 *   счёта на один месяц подписки);
 * — ответ 202 не повторяется (то же самое, но по другой причине);
 * — подпись вебхука считается по сырому телу и не принимает старое событие;
 * — один платёж продлевает подписку ровно один раз.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";

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
const { normalizePhone, ToleBillerService } = require(path.join(dist, "billing/tole-biller.service.js"));
const { ToleClient, ToleError } = require(path.join(dist, "billing/tole.client.js"));
const { verifyToleSignature } = require(path.join(dist, "billing/tole-webhook.controller.js"));
const { BillingService } = require(path.join(dist, "billing/billing.service.js"));
const { howToPay } = require(path.join(dist, "notifications/notification-templates.js"));

// ── Телефон в формате, который принимает Tole ──────────────────────────────
for (const [raw, want] of [
  ["+77761919941", "+77761919941"],
  ["77761919941", "+77761919941"],
  ["87761919941", "+77761919941"],
  ["8 776 191 99 41", "+77761919941"],
  ["+7 (776) 191-99-41", "+77761919941"],
]) {
  checked++;
  if (normalizePhone(raw) !== want) failures.push(`телефон «${raw}» → ${normalizePhone(raw)}, а нужно ${want}`);
}

// ── Подпись вебхука ────────────────────────────────────────────────────────
{
  const secret = "whsec_test_secret";
  const id = "6f1f0b5a-0000-4000-8000-000000000001";
  const body = JSON.stringify({ id, type: "payment.paid", data: { environment: "live" } });
  const now = Math.floor(Date.now() / 1000);
  const sign = (i, ts, b, s = secret) =>
    "v1=" + createHmac("sha256", s).update(`${i}.${ts}.${b}`, "utf8").digest("hex");

  const raw = Buffer.from(body, "utf8");
  check(verifyToleSignature(raw, id, String(now), sign(id, now, body), secret), "правильная подпись не принята");
  check(
    !verifyToleSignature(raw, id, String(now), sign(id, now, body, "whsec_другой"), secret),
    "подпись чужим ключом принята",
  );
  check(
    !verifyToleSignature(Buffer.from(body.replace("payment.paid", "payment.failed")), id, String(now), sign(id, now, body), secret),
    "подменённое тело принято — подпись считается не по сырому телу",
  );
  check(
    !verifyToleSignature(raw, id, String(now - 3600), sign(id, now - 3600, body), secret),
    "часовой давности событие принято — перехваченное годилось бы вечно",
  );
  check(!verifyToleSignature(raw, id, String(now), sign(id, now, body), ""), "без секрета подпись принята");
  check(!verifyToleSignature(undefined, id, String(now), sign(id, now, body), secret), "без тела подпись принята");
}

// ── Клиент: заголовки, идемпотентность, три исхода ─────────────────────────
{
  const realFetch = globalThis.fetch;
  const was = { key: envMod.env.toleApiKey, conn: envMod.env.toleConnectionId, base: envMod.env.toleBaseUrl };
  envMod.env.toleApiKey = "tole_sk_test_v1_xxx";
  envMod.env.toleConnectionId = "11111111-2222-3333-4444-555555555555";
  envMod.env.toleBaseUrl = "https://api.tolepay.kz/v1";

  const calls = [];
  const stubFetch = (status, json) => {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return { status, text: async () => JSON.stringify(json) };
    };
  };

  const client = new ToleClient();
  client.logger = { log() {}, warn() {}, error() {} };

  // Счёт создан
  stubFetch(201, { ok: true, data: { id: "op-1", status: "created" }, commandId: "cmd-1" });
  const created = await client.createInvoice({
    phoneNumber: "+77761919941",
    amountTenge: 10000,
    comment: "подписка",
    idempotencyKey: "kerektap-invoice-12345678",
  });
  check(created.kind === "created" && created.operationId === "op-1", "счёт не распознан как созданный");

  const h = calls[0].init.headers;
  check(h.Authorization === "Bearer tole_sk_test_v1_xxx", "ключ не ушёл в заголовке");
  check(h["Idempotency-Key"] === "kerektap-invoice-12345678", "ключ идемпотентности не ушёл");
  check(h["X-Tole-Connection-Id"] === "11111111-2222-3333-4444-555555555555", "подключение не указано");
  check(JSON.parse(calls[0].init.body).amount === 10000, "сумма ушла не та");
  check(String(calls[0].url).endsWith("/invoices"), "запрос ушёл не на /invoices");

  // 202: команда выполняется
  stubFetch(202, { ok: false, kind: "in_progress", commandId: "cmd-2", replayed: true });
  const pending = await client.createInvoice({ phoneNumber: "+77761919941", amountTenge: 10000, idempotencyKey: "k" });
  check(pending.kind === "in_progress" && pending.commandId === "cmd-2", "202 in_progress разобран неверно");

  // 202: исход неизвестен — повторять нельзя
  stubFetch(202, { ok: false, kind: "outcome_unknown", commandId: "cmd-3", replayed: false });
  const unknown = await client.createInvoice({ phoneNumber: "+77761919941", amountTenge: 10000, idempotencyKey: "k" });
  check(unknown.kind === "outcome_unknown", "202 outcome_unknown разобран неверно");

  // Ошибка
  stubFetch(402, { statusCode: 402, code: "BILLING_ENTITLEMENT_MISSING", message: "Активируйте тариф" });
  let thrown = null;
  try {
    await client.createInvoice({ phoneNumber: "+77761919941", amountTenge: 10000, idempotencyKey: "k" });
  } catch (err) {
    thrown = err;
  }
  check(thrown instanceof ToleError && thrown.code === "BILLING_ENTITLEMENT_MISSING", "ошибка тарифа не поднята");
  check(thrown && thrown.retryable === false, "ошибку тарифа сочли повторяемой — будем долбить впустую");

  globalThis.fetch = realFetch;
  envMod.env.toleApiKey = was.key;
  envMod.env.toleConnectionId = was.conn;
  envMod.env.toleBaseUrl = was.base;
}

// ── Шлюз: что сохраняется в счёте ──────────────────────────────────────────
{
  function stand(createResult) {
    const updates = [];
    const asked = [];
    const svc = Object.create(ToleBillerService.prototype);
    svc.logger = { log() {}, warn() {}, error() {} };
    svc.prisma = { subscriptionInvoice: { update: async (args) => updates.push(args) } };
    svc.tole = {
      createInvoice: async (opts) => {
        asked.push(opts);
        if (createResult instanceof Error) throw createResult;
        return createResult;
      },
    };
    return { svc, updates, asked };
  }

  const invoice = { id: "i1", number: "12345678", amountTenge: 10000, periodDays: 30, externalId: null };

  {
    const { svc, updates, asked } = stand({ kind: "created", operationId: "op-9", commandId: "cmd-9" });
    const ok = await svc.deliverInvoice(invoice, "8 776 191 99 41");
    check(ok === true, "созданный счёт не признан отправленным");
    check(asked[0]?.phoneNumber === "+77761919941", "телефон ушёл в неподходящем формате");
    check(
      asked[0]?.idempotencyKey === "kerektap-invoice-12345678",
      `ключ идемпотентности «${asked[0]?.idempotencyKey}» не выведен из номера счёта`,
    );
    check(updates[0]?.data?.externalId === "op-9", "идентификатор операции не сохранён — платёж будет не с чем свести");
    check(updates[0]?.data?.provider === "tole", "счёт не помечен как выставленный через Tole");
  }

  // Счёт уже выставлен — второй раз не просим ни при каких условиях
  {
    const { svc, asked } = stand({ kind: "created", operationId: "op-нельзя" });
    const ok = await svc.deliverInvoice({ ...invoice, externalId: "op-9" }, "+77761919941");
    check(ok === true && asked.length === 0, "повторно выставили счёт, который уже есть");
  }

  // Исход неизвестен: команду сохраняем, «отправлено» не говорим
  {
    const { svc, updates } = stand({ kind: "outcome_unknown", commandId: "cmd-x" });
    const ok = await svc.deliverInvoice(invoice, "+77761919941");
    check(ok === false, "неизвестный исход выдан за отправленный счёт");
    check(updates[0]?.data?.externalCommandId === "cmd-x", "команда не сохранена — исход уже не узнать");
  }

  // Tole недоступен: молча ничего не обещаем
  {
    const { svc } = stand(new ToleError(503, "PUBLIC_API_UNAVAILABLE", "недоступен"));
    const ok = await svc.deliverInvoice(invoice, "+77761919941");
    check(ok === false, "при недоступном Tole счёт выдан за отправленный");
  }
}

// ── Зачисление платежа: ровно один раз ─────────────────────────────────────
{
  function stand({ paid = true, claimCount = 1 } = {}) {
    const extended = [];
    const events = [];
    let claims = 0;
    const svc = Object.create(BillingService.prototype);
    svc.logger = { log() {}, warn() {}, error() {} };
    svc.prisma = {
      subscriptionInvoice: {
        findMany: async () => [
          {
            id: "i1",
            number: "12345678",
            supplierId: "s1",
            amountTenge: 10000,
            periodDays: 30,
            externalId: "op-9",
            externalCommandId: null,
          },
        ],
        // Замок: второй заход по тому же счёту не находит PENDING.
        updateMany: async () => ({ count: claims++ === 0 ? claimCount : 0 }),
      },
      tolePaymentEvent: {
        findUnique: async ({ where }) => events.find((e) => e.id === where.id) ?? null,
        create: async ({ data }) => events.push(data),
      },
    };
    svc.toleBiller = {
      resolveCommand: async () => null,
      paymentStatus: async () => ({ paid, amountTenge: 10000 }),
    };
    svc.extendSubscription = async (supplierId, days, provider) => extended.push({ supplierId, days, provider });
    return { svc, extended, events };
  }

  const wasEnabled = envMod.env.toleEnabled;
  const wasKey = envMod.env.toleApiKey;
  envMod.env.toleEnabled = true;
  envMod.env.toleApiKey = "tole_sk_live_v1_xxx";

  {
    const { svc, extended } = stand();
    const paid = await svc.reconcileToleInvoices();
    check(paid === 1, "оплаченный счёт не зачтён");
    check(extended[0]?.days === 30, `продлили на ${extended[0]?.days} дней вместо 30`);
    check(extended[0]?.provider === "tole", "платёж записан не на Tole");

    // Вторая сверка того же счёта — подписка не должна продлиться дважды.
    const again = await svc.reconcileToleInvoices();
    check(again === 0 && extended.length === 1, "повторная сверка продлила подписку второй раз");
  }

  // Неоплаченный счёт не трогаем
  {
    const { svc, extended } = stand({ paid: false });
    check((await svc.reconcileToleInvoices()) === 0, "неоплаченный счёт зачтён как оплаченный");
    check(extended.length === 0, "подписка продлена без оплаты");
  }

  // Событие вебхука: повтор не приводит ко второй сверке
  {
    const { svc, extended, events } = stand();
    await svc.handleToleEvent({ id: "ev-1", type: "payment.paid", data: {} });
    await svc.handleToleEvent({ id: "ev-1", type: "payment.paid", data: {} });
    check(events.length === 1, "повторное событие записано дважды");
    check(extended.length === 1, "повторное событие продлило подписку ещё раз");
  }

  // Выключили Tole, вернувшись к биллеру, — но счёт у человека на руках.
  // Сверка обязана продолжаться: он платит по нему и завтра.
  {
    envMod.env.toleEnabled = false;
    const { svc, extended } = stand();
    check((await svc.reconcileToleInvoices()) === 1, "выставленный счёт перестали сверять — деньги потеряются");
    check(extended.length === 1, "оплата по старому счёту не продлила подписку");
    envMod.env.toleEnabled = true;
  }

  // Ключа нет вовсе — ходить некуда и не с чем.
  {
    envMod.env.toleApiKey = "";
    const { svc, extended } = stand();
    check((await svc.reconcileToleInvoices()) === 0, "сверка идёт без ключа");
    check(extended.length === 0, "подписка продлена без ключа");
    envMod.env.toleApiKey = "tole_sk_live_v1_xxx";
  }

  envMod.env.toleEnabled = wasEnabled;
  envMod.env.toleApiKey = wasKey;
}

// ── Текст: человек должен понять, куда платить ─────────────────────────────
{
  const tole = howToPay({ toleInvoice: true, priceTenge: 10000, periodDays: 30, supportPhone: "+7 778 709 8251" }, "ru");
  check(/10000 ₸/.test(tole), "в тексте нет суммы");
  check(/Kaspi/.test(tole), "не сказано, где платить");
  check(!/номер счёта/i.test(tole), "счёту Tole номер не нужен — он сам приходит в приложение");

  const kaspi = howToPay(
    { invoiceNumber: "12345678", priceTenge: 10000, periodDays: 30, kaspiServiceName: "KerekTap", supportPhone: "+7 778 709 8251" },
    "ru",
  );
  check(/12345678/.test(kaspi), "в тексте биллера нет номера счёта");
  check(/Платежи/.test(kaspi), "в тексте биллера нет пути в приложении Kaspi");

  const none = howToPay({ supportPhone: "+7 778 709 8251" }, "ru");
  check(/778 709 8251/.test(none), "когда платить нечем, должен остаться телефон живого человека");
  check(!/сч[её]т №/i.test(none), "обещан счёт, которого нет");

  for (const p of [{ toleInvoice: true, priceTenge: 1, periodDays: 1 }, { invoiceNumber: "1" }, {}]) {
    checked++;
    if (!howToPay(p, "kk")) failures.push("казахский текст пуст");
  }
}

export default { name: "счета через Tole", checked, failures };
