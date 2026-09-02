/**
 * Две правки по прогону 2 сентября.
 *
 * Первая: бот отвечал на вопрос и в том же сообщении сообщал, что не понял
 * его. На «Можна по казахский?» он переключил язык — то есть просьбу понял, —
 * и следом сказал «мен оны түсінбедім». То же на «Сколько стоит?» и «А вы
 * кто такие?». Отвечает роутер, а жалуется orders.service; друг о друге они
 * не знали.
 *
 * Вторая: клиенту сказали «Отправил заявку 10 исполнителям. Позвонят в
 * ближайшие 15–30 минут», тогда как настоящую заявку получили семеро, а
 * остальные — приглашение «интересно ли». Приглашённый позвонит, только если
 * сначала согласится.
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

// ── «Я его не понял» — только когда мы правда не ответили ──────────────────
{
  const { OrdersService } = require(path.join(dist, "orders/orders.service.js"));

  /** Прогнать applyFieldUpdate с вопросом в ответе на поле города. */
  async function turnWith(questionAnswered) {
    const svc = Object.create(OrdersService.prototype);
    svc.prisma = {
      order: { update: async () => ({}) },
      chatMessage: { create: async () => ({}) },
      supplierProfile: { count: async () => 3 },
    };
    svc.logger = { log() {}, warn() {}, error() {} };
    svc.categories = {};
    svc.appendDescription = async () => {};
    // Карточка заявки в ответе нас здесь не интересует — проверяем текст.
    svc.toDto = async () => ({ number: 1, status: "DRAFT" });
    const category = {
      id: "c1",
      slug: "dump-truck",
      fields: [
        { key: "city", type: "text", required: true, label: { ru: "Город", kk: "Қала" }, question: { ru: "В каком городе нужна услуга?", kk: "" } },
      ],
    };
    // «Сколько стоит?» в поле города — вопрос, а не ответ: его отбрасывают.
    return svc.applyFieldUpdate("o1", category, { city: "Сколько стоит?" }, "ru", {
      previousFields: {},
      questionAnswered,
    });
  }

  const silent = await turnWith(true);
  check(
    !/не понял/i.test(silent.assistantMessage),
    `после ответа на вопрос бот всё равно сказал «не понял»: «${silent.assistantMessage.slice(0, 90)}»`,
  );
  check(
    /городе/i.test(silent.assistantMessage),
    "вопрос шага пропал — человек не знает, что от него хотят",
  );

  const noticed = await turnWith(false);
  check(
    /не понял/i.test(noticed.assistantMessage),
    "без ответа на вопрос пояснение исчезло — тот же вопрос заново выглядит как игнор",
  );
}

// ── Приглашение — не отправленная заявка ──────────────────────────────────
{
  const { MatchingService } = require(path.join(dist, "matching/matching.service.js"));

  async function wave(outcomes, { waveNumber = 1, broadcastLogged = 0 } = {}) {
    const said = [];
    const svc = Object.create(MatchingService.prototype);
    const order = {
      id: "o1", number: 200, city: "Астана", urgent: false, status: "PUBLISHED",
      dispatchPausedAt: null,
      category: { name: { ru: "Вывоз строительного мусора", kk: "" }, fields: [] },
      fieldsData: {},
      client: { user: { phone: "+77015550022", preferredLanguage: "RU" } },
    };
    svc.prisma = {
      order: { findUniqueOrThrow: async () => order },
      dispatchWave: { create: async () => ({}), count: async () => waveNumber - 1 },
      notificationLog: { count: async () => broadcastLogged, findMany: async () => [] },
    };
    svc.logger = { log() {}, warn() {}, error() {} };
    svc.analytics = { track: async () => {} };
    svc.realtime = { emitOrderUpdated() {} };
    svc.orders = { toDto: async () => ({}) };
    svc.matchingQueue = { add: async () => {} };
    svc.getSettings = async () => ({ waveSize: 10, quietHoursStart: null, quietHoursEnd: null });
    svc.getAlreadyNotifiedSupplierIds = async () => [];
    svc.findCandidates = async () => outcomes.map((_, i) => ({ id: "s" + i, user: {}, confirmedAt: new Date() }));
    svc.tellClient = async (_o, ru) => said.push(ru);
    let i = 0;
    svc.dispatchToSupplier = async () => outcomes[i++];
    svc.currentWaveNumber = async () => waveNumber;
    await svc.sendWave("o1", waveNumber);
    return said.join("\n---\n");
  }

  // Случай заявки №107: трое подключённых, семеро приглашённых.
  {
    const out = await wave(["sent", "sent", "sent", "invited", "invited", "invited", "invited", "invited", "invited", "invited"]);
    check(/3 исполнител/.test(out), `названо не число получивших заявку: «${out.slice(0, 100)}»`);
    check(!/10 исполнителям/.test(out), "в текст попали приглашённые вместе с получившими заявку");
  }

  // Заявку не получил никто — только приглашения. Звонков обещать нельзя.
  {
    const out = await wave(["invited", "invited", "invited"]);
    check(!/Позвонят в ближайшие/.test(out), `обещаны звонки от тех, кто ещё не согласился: «${out.slice(0, 110)}»`);
    check(!/Отправил заявку/.test(out), "сказано «отправил заявку», хотя её никто не получил");
    check(/подбираем/i.test(out), `не объяснено, что происходит: «${out.slice(0, 110)}»`);
  }

  // Обычная волна без приглашений не изменилась.
  {
    const out = await wave(["sent", "sent", "sent"]);
    check(/3 исполнителям/.test(out), "обычная рассылка стала называть неверное число");
    check(/Позвонят в ближайшие/.test(out), "у обычной рассылки пропало обещание звонков");
  }

  // ── Откуда берётся «invited» ────────────────────────────────────────────
  //
  // Проверки выше подменяют dispatchToSupplier целиком, поэтому сами по себе
  // они не заметят, если холодная ветка снова начнёт возвращать «sent».
  // Здесь гоняем настоящий метод.
  {
    const svc = Object.create(MatchingService.prototype);
    const sends = [];
    svc.logger = { log() {}, warn() {}, error() {} };
    svc.notifications = { send: async (msg) => sends.push(msg) };
    svc.billing = {
      checkAndConsumeQuota: async () => true,
      maybeSendQuotaReminder: async () => {},
    };
    svc.prisma = { pendingSupplierNotification: { upsert: async () => ({}) } };
    svc.mayInviteAgain = async () => true;

    const order = {
      id: "o1", number: 201, city: "Астана", urgent: true,
      category: { name: { ru: "Вывоз строительного мусора", kk: "" }, fields: [] },
      fieldsData: {},
      client: { user: { phone: "+77015550022", preferredLanguage: "RU" } },
    };
    const settings = { quietHoursStart: null, quietHoursEnd: null };
    const supplier = (confirmed) => ({
      id: confirmed ? "s-warm" : "s-cold",
      confirmedAt: confirmed ? new Date() : null,
      user: { phone: "+77015551001", preferredLanguage: "RU" },
      workingHoursStart: null,
      workingHoursEnd: null,
    });

    const cold = await svc.dispatchToSupplier(order, supplier(false), settings);
    check(cold === "invited", `неподключённому исполнителю ушло «${cold}» вместо «invited»`);
    check(
      sends.some((m) => m.event === "supplier_cold_invite"),
      "неподключённому ушло не приглашение",
    );

    sends.length = 0;
    const warm = await svc.dispatchToSupplier(order, supplier(true), settings);
    check(warm === "sent", `подключённому исполнителю ушло «${warm}» вместо «sent»`);
    check(
      sends.some((m) => m.event !== "supplier_cold_invite"),
      "подключённому ушло приглашение вместо заявки",
    );
  }
}

export default { name: "ответ и приглашения", checked, failures };
