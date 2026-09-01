/**
 * Клиенту называют тех, кому заявка ушла, а не тех, чьё место занято.
 *
 * Заявка №158, 1 сентября, автокран, 21:34. Клиент написал «Сейчас». Из шести
 * подтверждённых исполнителей в Астане круглосуточно работают двое — заявка
 * ушла одному. Остальные девять попали в отложенные: они получат её утренним
 * дайджестом.
 *
 * А клиент в 21:41 прочитал «Разослали заявку №158 ещё 5 исполнителям».
 * Никому не разослали: в коде отложенная отправка занимала место в волне и
 * считалась успешной наравне с настоящей.
 *
 * Проверяем на самом сервисе с подменённой отправкой: тексты обязаны
 * соответствовать тому, что произошло.
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

const { MatchingService } = require(path.join(dist, "matching/matching.service.js"));

/**
 * Прогнать одну волну. outcomes — что вернёт отправка по каждому кандидату.
 */
async function wave(outcomes, waveNumber, broadcastLogged) {
  const said = [];
  const svc = Object.create(MatchingService.prototype);

  const order = {
    id: "o1",
    number: 158,
    city: "Астана",
    urgent: false,
    status: "PUBLISHED",
    dispatchPausedAt: null,
    category: { name: { ru: "Автокран", kk: "Автокран" }, fields: [] },
    fieldsData: {},
    client: { user: { phone: "+77079548128", preferredLanguage: "RU" } },
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
  svc.getSettings = async () => ({ waveSize: 5, quietHoursStart: null, quietHoursEnd: null });
  svc.getAlreadyNotifiedSupplierIds = async () => [];
  svc.findCandidates = async () => outcomes.map((_, i) => ({ id: "s" + i, user: {}, confirmedAt: new Date() }));
  svc.tellClient = async (_o, ru) => {
    said.push(ru);
  };
  let i = 0;
  svc.dispatchToSupplier = async () => outcomes[i++];
  svc.currentWaveNumber = async () => waveNumber;

  await svc.sendWave("o1", waveNumber);
  return said.join("\n---\n");
}

// ── Первая волна: одному ушло, четверо ждут утра (случай №158) ─────────────
{
  const out = await wave(["sent", "deferred", "deferred", "deferred", "deferred"], 1, 1);
  check(/1 исполнител/.test(out), `названо неверное число отправленных: «${out.slice(0, 80)}»`);
  check(/Ещё 4 получат заявку утром/.test(out), "не сказано, что четверо получат утром");
  check(!/5 исполнителям/.test(out), "в текст попало число занятых мест вместо отправленных");
}

// ── Вторая волна: никому не ушло, все отложены ─────────────────────────────
{
  const out = await wave(["deferred", "deferred", "deferred", "deferred", "deferred"], 2, 1);
  check(!/Разослали/.test(out), `сказано «разослали», хотя не отправлено никому: «${out.slice(0, 90)}»`);
  check(out === "", "на второй волне без отправок бот всё-таки написал клиенту");
}

// ── Первая волна ночью: никому не ушло, все отложены ───────────────────────
{
  const out = await wave(["deferred", "deferred", "deferred"], 1, 0);
  check(/нерабочее время/.test(out), "не объяснено, почему звонков не будет сейчас");
  check(/3 человек/.test(out), "не названо, сколько получат утром");
  check(!/Позвонят в ближайшие/.test(out), "обещаны звонки в ближайшие полчаса, хотя никому не отправлено");
}

// ── Обычная дневная волна: всё ушло, приписки про утро быть не должно ──────
{
  const out = await wave(["sent", "sent", "sent"], 1, 3);
  check(/3 исполнителям/.test(out), "неверное число при обычной рассылке");
  check(!/утром/.test(out), "приписка про утро появилась там, где никого не откладывали");
}

// ── Вторая волна, часть ушла ───────────────────────────────────────────────
{
  const out = await wave(["sent", "sent", "deferred"], 2, 5);
  check(/ещё 2 исполнителям/.test(out), `вторая волна называет не то число: «${out.slice(0, 90)}»`);
  check(/Ещё 1 получат заявку утром/.test(out), "не упомянут отложенный");
}

export default { name: "честность чисел в рассылке", checked, failures };
