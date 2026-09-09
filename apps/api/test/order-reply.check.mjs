/**
 * Ответ исполнителя по заявке: исход сделки и жалоба на клиента.
 *
 * Бердижан, +7 776 191 9941, 9 сентября. Подключился в 16:52, получил заявку
 * №173, в 17:04 написал «Не берут телефон» — и реплика осела в описании
 * техники вместе с ответом «учтём при подборе заявок». Заявка провисела
 * опубликованной до 17:10, владелец не узнал ничего.
 *
 * Причина: вызов recordOrderReply пропал из ветки подтверждённого поставщика
 * 2 сентября (cc90cda) — ветку вопроса о заявках вставили НА его место.
 * Неделю ни один ответ по заявке не записывался, и SupplierOrderReply пуста.
 *
 * Поэтому первая проверка здесь — не про текст, а про порядок: он и есть
 * поведение, и читается из собранного кода, а не переписан в тест руками.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCompiled, buildScope, sliceRegion, extractGuardOrder } from "./lib/source.mjs";

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

// ── Порядок проверок в ветке подтверждённого поставщика ────────────────────
{
  const region = sliceRegion(src, "if (MORE_ORDERS_RE.test(text))", "tryIntentFallback");
  const order = extractGuardOrder(region, [
    "MORE_ORDERS_RE",
    "recordOrderReply",
    "SUPPLIER_SCOPE_RE",
    "looksLikeSelfInfo",
  ]);
  check(
    order.includes("recordOrderReply"),
    "recordOrderReply не вызывается — ответы по заявке снова уходят в профиль",
  );
  check(
    order.indexOf("MORE_ORDERS_RE") < order.indexOf("recordOrderReply"),
    `«есть ещё заказы» должно проверяться раньше исхода сделки, порядок: ${order.join(" → ")}`,
  );
  check(
    order.indexOf("recordOrderReply") < order.indexOf("looksLikeSelfInfo"),
    `исход сделки должен проверяться раньше записи в профиль, порядок: ${order.join(" → ")}`,
  );
}

// ── Распознаватель недозвона ───────────────────────────────────────────────
{
  const { CLIENT_UNREACHABLE_RE } = buildScope(src, ["CLIENT_UNREACHABLE_RE"]);
  for (const [text, want] of [
    // Реплика Бердижана, дословно
    ["Не берут телефон", true],
    ["не берёт трубку", true],
    ["Клиент не отвечает", true],
    ["Абонент недоступен", true],
    ["телефон выключен", true],
    ["Не могу дозвониться", true],
    ["сбрасывает звонки", true],
    ["номер не верный", true],
    ["Телефон алмайды", true],
    ["Жауап бермейді", true],
    // Не жалоба: обычный разговор по заявке и рассказ о себе
    ["Взял заявку, еду", false],
    ["Договорились, завтра в 10", false],
    ["Сколько платят по этой заявке", false],
    ["У меня автокран 25тн", false],
    ["Астана", false],
    ["Не берусь, далеко", true],
  ]) {
    checked++;
    if (CLIENT_UNREACHABLE_RE.test(text) !== want) {
      failures.push(`недозвон «${text}»: распознан неверно`);
    }
  }
}

// ── Жалоба: строка в заявке, оповещение владельцу, ответ с номером ─────────
{
  const { WhatsAppRouterService } = require(path.join(dist, "whatsapp/whatsapp-router.service.js"));

  function stand() {
    const sent = [];
    const rows = [];
    const alerts = [];
    const svc = Object.create(WhatsAppRouterService.prototype);
    svc.whatsapp = { sendText: async (_p, body) => sent.push(body) };
    svc.logger = { log() {}, warn() {}, error() {} };
    svc.prisma = {
      supplierOrderReply: { create: async ({ data }) => rows.push(data) },
      notificationLog: { findMany: async () => [{ orderId: "o173" }] },
      order: { findFirst: async () => ({ id: "o173", number: 173 }) },
    };
    svc.newOrderAlert = {
      alertOrderProblem: async (...args) => alerts.push(args),
    };
    return { svc, sent, rows, alerts };
  }

  {
    const { svc, sent, rows, alerts } = stand();
    const handled = await svc.recordOrderReply("+77761919941", { id: "s1" }, "Не берут телефон", "ru");
    check(handled === true, "жалоба на недозвон не перехвачена — уйдёт в описание техники");
    check(rows.length === 1, "жалоба не записана к заявке");
    check(rows[0]?.orderId === "o173", "жалоба привязана не к той заявке");
    check(rows[0]?.outcome === "unreachable", `исход записан как «${rows[0]?.outcome}», а не «unreachable»`);
    check(alerts.length === 1, "владелец не узнал о недозвоне");
    check(alerts[0]?.[1] === 173, "в оповещении владельцу нет номера заявки");
    check(alerts[0]?.[2] === "+77761919941", "в оповещении нет телефона исполнителя");
    check(/№173/.test(sent.join("\n")), `в ответе исполнителю нет номера заявки: «${sent.join(" ")}»`);
    check(/не отвечает/i.test(sent.join("\n")), "ответ не о том, о чём написал человек");
    check(!/учт[её]м при подборе/.test(sent.join("\n")), "остался ответ про подбор заявок");
  }

  // Вопрос о недозвоне — та же ситуация, тот же разбор.
  {
    const { svc, rows, alerts } = stand();
    await svc.recordOrderReply("+77761919941", { id: "s1" }, "Почему клиент не берёт трубку?", "ru");
    check(rows[0]?.outcome === "unreachable", "вопрос о недозвоне не признан жалобой");
    check(alerts.length === 1, "по вопросу о недозвоне владельца не оповестили");
  }

  // Обычное согласие по заявке по-прежнему записывается как сделка.
  {
    const { svc, sent, rows, alerts } = stand();
    const handled = await svc.recordOrderReply("+77761919941", { id: "s1" }, "Беру заявку", "ru");
    check(handled === true, "согласие по заявке не перехвачено");
    check(rows[0]?.outcome === "agreed", `согласие записано как «${rows[0]?.outcome}»`);
    check(alerts.length === 0, "по обычному согласию владельца дёргать не надо");
    check(/№173/.test(sent.join("\n")), "в ответе на согласие нет номера заявки");
  }
}

// ── Город, который у исполнителя уже указан, в заметку не пишем ────────────
{
  const { WhatsAppRouterService } = require(path.join(dist, "whatsapp/whatsapp-router.service.js"));

  function stand() {
    const sent = [];
    const buttons = [];
    const updates = [];
    const svc = Object.create(WhatsAppRouterService.prototype);
    svc.whatsapp = {
      sendText: async (_p, body) => sent.push(body),
      sendButtons: async (_p, body) => buttons.push(body),
    };
    svc.logger = { log() {}, warn() {}, error() {} };
    svc.prisma = { supplierProfile: { update: async (args) => updates.push(args) } };
    return { svc, sent, buttons, updates };
  }

  const berdizhan = { id: "s1", selfDescription: null, serviceAreas: [{ city: "Астана" }] };

  {
    const { svc, sent, updates } = stand();
    await svc.captureSupplierInfo("+77761919941", berdizhan, "Астана", "ru");
    check(updates.length === 0, "город, который уже указан, всё равно записан в описание техники");
    check(/Астана/.test(sent.join("\n")), "в ответе не названо, о каком городе речь");
    check(/уже указан/i.test(sent.join("\n")), `ответ не говорит, что город уже есть: «${sent.join(" ")}»`);
    check(!/Записал/.test(sent.join("\n")), "«Записал» о том, что не записывали");
  }

  // Город плюс что-то новое — сохраняем целиком, это и есть заметка профиля.
  {
    const { svc, sent, updates } = stand();
    await svc.captureSupplierInfo("+77761919941", berdizhan, "Астана, есть манипулятор 5 тонн", "ru");
    check(updates.length === 1, "рассказ о технике не сохранён");
    check(
      /манипулятор/i.test(updates[0]?.data?.selfDescription ?? ""),
      "в профиль попало не то, что человек написал",
    );
    check(/Записал/.test(sent.join("\n")), "человек не увидел, что его услышали");
  }

  // Новый город по-прежнему предлагается кнопкой, а не добавляется молча.
  {
    const { svc, buttons, updates } = stand();
    await svc.captureSupplierInfo("+77761919941", berdizhan, "Караганда", "ru");
    check(updates.length === 1, "новый город не сохранён в заметку");
    check(/Караганд/i.test(buttons.join("\n")), "новый город не предложен кнопкой");
  }
}

export default { name: "ответ по заявке", checked, failures };
