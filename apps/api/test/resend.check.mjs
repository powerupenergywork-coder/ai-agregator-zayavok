/**
 * Клиент просит разослать заявку ещё раз.
 *
 * Заявка №159, +7 700 424 2050. Вечером 1 сентября заявку опубликовали в
 * 23:08 — время нерабочее, поэтому она ушла исполнителям только утренним
 * дайджестом в 08:00. Клиент об этом не знал: ему трижды сказали «Отправил
 * заявку 5 исполнителям… позвонят в ближайшие 15–30 минут». Прождав до 23:24
 * без единого звонка, он написал «Хватит» — и сам остановил рассылку.
 *
 * Утром: «Можно сделать рассылку» → «Заявка №159. Что в итоге?»; «Не нашел» →
 * «исполнители перезвонят вам сами». Звонить было некому: рассылка стояла на
 * паузе, а снять её словами клиент не мог — команда была только у админа.
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

// ── Распознавание просьбы ──────────────────────────────────────────────────
const src = readCompiled("whatsapp/whatsapp-router.service.js");
const { RESEND_RE, ENOUGH_CALLS_RE, CLIENT_CANCEL_RE } = buildScope(src, [
  "RESEND_RE",
  "ENOUGH_CALLS_RE",
  "CLIENT_CANCEL_RE",
]);

for (const [text, want] of [
  // Обе реплики клиента №159, дословно
  ["Можно сделать рассылку", true],
  ["еще не нашел может отправить повторно", true],
  ["разошлите ещё раз", true],
  ["отправьте заявку снова", true],
  ["можно ещё раз разослать", true],
  ["қайта жіберіңіз", true],
  // Не просьба о рассылке
  ["Хватит звонков", false],
  ["Уже нашёл исполнителя", false],
  ["не надо", false],
  ["Астана", false],
  ["Сколько стоит", false],
  ["Спасибо", false],
]) {
  checked++;
  if (RESEND_RE.test(text) !== want) {
    failures.push(`«${text}» ${want ? "не распознано как просьба разослать" : "ошибочно принято за просьбу разослать"}`);
  }
}

// Просьба разослать и просьба замолчать не должны путаться местами.
check(!ENOUGH_CALLS_RE.test("Можно сделать рассылку"), "просьбу разослать приняли за «хватит звонков»");
check(!CLIENT_CANCEL_RE.test("еще не нашел может отправить повторно"), "просьбу разослать приняли за отмену заявки");

// ── Возобновление снимает паузу и запускает волну ──────────────────────────
{
  const { WhatsAppRouterService } = require(path.join(dist, "whatsapp/whatsapp-router.service.js"));

  function stand({ resumeFails = false, already = 3 } = {}) {
    const sent = [];
    const calls = { resumed: 0, waves: 0, ownerAlerts: 0 };
    const svc = Object.create(WhatsAppRouterService.prototype);
    svc.logger = { log() {}, warn() {}, error() {} };
    svc.whatsapp = { sendText: async (_p, body) => sent.push(body) };
    svc.orders = {
      countDispatchedSuppliers: async () => already,
      resumeDispatch: async () => {
        calls.resumed++;
        if (resumeFails) throw new Error("база недоступна");
      },
    };
    svc.matching = { sendWave: async () => { calls.waves++; } };
    svc.newOrderAlert = { alertWantsHuman: async () => { calls.ownerAlerts++; } };
    return { svc, sent, calls };
  }

  {
    const { svc, sent, calls } = stand({ already: 15 });
    await svc.resumeDispatchForClient("+77004242050", "o1", 159, "ru");
    check(calls.resumed === 1, "пауза не снята");
    check(calls.waves === 1, "новая волна не запущена — обещание без действия");
    const out = sent.join("\n");
    check(/продолжил поиск/i.test(out), `клиенту не сказано, что поиск продолжен: «${out}»`);
    check(/15 исполнител/.test(out), `не названо, скольким заявка уже уходила: «${out}»`);
  }

  // Ни разу не уходила — числа быть не должно, иначе «получили 0 исполнителей».
  {
    const { svc, sent } = stand({ already: 0 });
    await svc.resumeDispatchForClient("+77004242050", "o1", 159, "ru");
    check(!/0 исполнител/.test(sent.join("\n")), "в тексте появилось «0 исполнителей»");
  }

  // Сбой не должен молча съесть просьбу.
  {
    const { svc, sent, calls } = stand({ resumeFails: true });
    await svc.resumeDispatchForClient("+77004242050", "o1", 159, "ru");
    const out = sent.join("\n");
    check(/не получилось/i.test(out), `о сбое клиенту не сказали: «${out}»`);
    check(calls.ownerAlerts === 1, "оператор не узнал о сбое");
    check(calls.waves === 0, "волна ушла, хотя пауза не снялась");
  }
}

// ── Просьба доходит до обработчика ────────────────────────────────────────
//
// Проверки выше зовут resumeDispatchForClient напрямую и потому не заметят,
// если ветка в разговоре пропадёт: обработчик останется рабочим, а вызывать
// его будет нечему.
{
  const compiled = readCompiled("whatsapp/whatsapp-router.service.js");
  check(
    /RESEND_RE\.test\(text\)/.test(compiled),
    "просьба разослать больше не проверяется в разговоре по заявке",
  );
  check(
    /resumeDispatchForClient\(/.test(compiled),
    "ветка не ведёт к возобновлению рассылки",
  );
  // Порядок: «хватит ждать, разошлите ещё» содержит и то, и другое слово.
  check(
    compiled.indexOf("RESEND_RE.test(text)") < compiled.indexOf("ENOUGH_CALLS_RE.test(text.trim())"),
    "просьба разослать проверяется после «хватит звонков» — во фразе с обоими словами победит тишина",
  );
}

// ── Пока рассылка на паузе, звонков не обещаем ────────────────────────────
{
  const { WhatsAppRouterService } = require(path.join(dist, "whatsapp/whatsapp-router.service.js"));
  const compiled = readCompiled("whatsapp/whatsapp-router.service.js");
  check(
    /isDispatchPaused\(attached\)/.test(compiled),
    "перед дежурной фразой не проверяется, не стоит ли рассылка на паузе",
  );
  const paused = compiled.slice(compiled.indexOf("isDispatchPaused(attached)"));
  check(
    /остановлена/.test(paused.slice(0, 600)),
    "на паузе клиенту не говорят прямо, что рассылка остановлена",
  );
  check(
    /разошлите ещ/i.test(paused.slice(0, 600)),
    "не подсказано, как возобновить поиск — человек снова останется ни с чем",
  );
}

export default { name: "повторная рассылка", checked, failures };
