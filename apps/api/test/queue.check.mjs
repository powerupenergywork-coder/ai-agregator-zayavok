/**
 * Очередь сообщений по чату (заявка №140).
 *
 * Человек написал заявку и через 3,8 секунды дописал «Здравствуйте!». Первое
 * сообщение ещё висело в классификаторе: черновик создан, категория не
 * записана. Второе прочитало заявку без категории и отправило в классификатор
 * слово «Здравствуйте!» — клиент получил список техники сразу после того, как
 * ему назвали цену вывоза мусора.
 *
 * Проверяем на настоящем классе роутера, подменив только сам разбор: нужна
 * механика очереди, а не поведение веток — их проверяет routing.check.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");

const failures = [];
let checked = 0;
const check = (ok, what) => {
  checked++;
  if (!ok) failures.push(what);
};

require("reflect-metadata");
const { WhatsAppRouterService } = require(path.join(dist, "whatsapp/whatsapp-router.service.js"));

const router = Object.create(WhatsAppRouterService.prototype);
router.chatQueues = new Map();

let concurrent = 0;
let peak = 0;
const order = [];

router.processIncoming = async (msg) => {
  concurrent++;
  peak = Math.max(peak, concurrent);
  await new Promise((r) => setTimeout(r, msg.delay));
  order.push(msg.text);
  concurrent--;
  if (msg.fail) throw new Error("разбор упал");
};

// ── Сценарий заявки №140: дописка внахлёст ─────────────────────────────────
const first = router.handleIncoming({ chatId: "A@c.us", text: "заявка", delay: 60 });
await new Promise((r) => setTimeout(r, 10));
const second = router.handleIncoming({ chatId: "A@c.us", text: "здравствуйте", delay: 10 });
await Promise.all([first, second]);

check(peak === 1, `разбор шёл параллельно: одновременно ${peak}`);
check(order.join(" → ") === "заявка → здравствуйте", `порядок нарушен: ${order.join(" → ")}`);

// ── Разные чаты друг друга не ждут ─────────────────────────────────────────
peak = 0;
order.length = 0;
await Promise.all([
  router.handleIncoming({ chatId: "B@c.us", text: "B", delay: 40 }),
  router.handleIncoming({ chatId: "C@c.us", text: "C", delay: 40 }),
]);
check(peak === 2, "разные чаты выстроились в одну очередь и тормозят друг друга");

// ── Упавшее сообщение не отменяет следующее ────────────────────────────────
order.length = 0;
const failing = router.handleIncoming({ chatId: "D@c.us", text: "падает", delay: 20, fail: true });
await new Promise((r) => setTimeout(r, 5));
const after = router.handleIncoming({ chatId: "D@c.us", text: "следующее", delay: 5 });
let thrown = false;
await failing.catch(() => {
  thrown = true;
});
await after;
check(thrown, "ошибка разбора не пробросилась наружу");
check(order.includes("следующее"), "следующее сообщение потерялось после упавшего");

// ── Карта хвостов не растёт ────────────────────────────────────────────────
await new Promise((r) => setTimeout(r, 20));
check(router.chatQueues.size === 0, `в карте очередей осталось ${router.chatQueues.size} записей`);

export default { name: "очередь сообщений", checked, failures };
