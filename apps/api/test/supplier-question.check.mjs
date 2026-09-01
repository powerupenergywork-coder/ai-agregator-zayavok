/**
 * Вопрос поставщика о заявках — и кнопка из закрытого вопроса.
 *
 * Обе ошибки из одной переписки: Шынгыс, +7 707 672 9687, 1 сентября, 21:17.
 *
 * Он спросил «На газель другие заказы не дадут кроме мусора что ли» и получил
 * «Записал… учтём при подборе заявок» — фраза осела в профиле как рассказ о
 * технике. Через минуту он написал «Стоп».
 *
 * Ещё через две минуты нажал «Моей нет в списке» — кнопку из вопроса, который
 * закончился четырьмя минутами раньше, — и не получил ничего. Кнопки в
 * WhatsApp живут вечно, а молчание в ответ на нажатие читается как поломка.
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

// ── Вопрос без знака вопроса ───────────────────────────────────────────────
const { looksLikeQuestion } = require(path.resolve(dist, "../../../packages/shared/dist/text-intent.js"));

for (const [text, want] of [
  // Реплика Шынгыса, дословно
  ["На газель другие заказы не дадут кроме мусора что ли", true],
  ["Разве по газели только мусор", true],
  ["Заявки будут или нет", true],
  ["Только мусор или как", true],
  ["Тапсырыс бар ма", true],
  ["Керек пе", true],
  // Рассказ о себе: цена ошибки здесь — сказанное не попадёт в профиль
  ["Услуги самосвала 25 тонн город Астана", false],
  ["У меня автокран 25тн стрела 42 метра", false],
  ["Работаю по Астане и области", false],
  ["Вроде договорились клиент озвонится", false],
  ["Обращайтесь если будет заявка", false],
  ["Манипулятор", false],
]) {
  checked++;
  if (looksLikeQuestion(text) !== want) {
    failures.push(`«${text}» ${want ? "не признан вопросом" : "ошибочно признан вопросом"}`);
  }
}

// ── Распознаватель темы: вопрос именно про заявки ──────────────────────────
const src = readCompiled("whatsapp/whatsapp-router.service.js");
const { SUPPLIER_SCOPE_RE } = buildScope(src, ["SUPPLIER_SCOPE_RE"]);
for (const [text, want] of [
  ["На газель другие заказы не дадут кроме мусора что ли", true],
  ["какие заявки будут приходить", true],
  ["мои категории какие", true],
  ["Здравствуйте", false],
  ["Астана", false],
]) {
  checked++;
  if (SUPPLIER_SCOPE_RE.test(text) !== want) {
    failures.push(`тема «${text}»: распознана неверно`);
  }
}

// ── Ответ по существу: перечень категорий и городов ────────────────────────
{
  const { WhatsAppRouterService } = require(path.join(dist, "whatsapp/whatsapp-router.service.js"));
  const sent = [];
  const svc = Object.create(WhatsAppRouterService.prototype);
  svc.whatsapp = { sendText: async (_p, body) => sent.push(body) };

  await svc.answerSupplierScope(
    "+77076729687",
    {
      id: "s1",
      categories: [
        { category: { name: { ru: "Газель", kk: "Газель" } } },
        { category: { name: { ru: "Вывоз строительного мусора", kk: "Құрылыс қоқысын шығару" } } },
      ],
      serviceAreas: [{ city: "Усть-Каменогорск" }],
    },
    "ru",
  );

  const out = sent.join("\n");
  check(/Газель/.test(out), `в ответе нет категории, о которой спрашивали: «${out}»`);
  check(/Вывоз строительного мусора/.test(out), "в ответе нет второй категории");
  check(/Усть-Каменогорск/.test(out), "в ответе нет города — человек не увидит, где его ждут заявки");
  check(/не смешиваются/.test(out), "не сказано главное: заявки разных категорий не смешиваются");
  check(!/учт[её]м при подборе/.test(out), "остался ложный ответ про подбор заявок");
}

// ── Кнопка закрытого вопроса получает ответ ────────────────────────────────
{
  const { WhatsAppRouterService } = require(path.join(dist, "whatsapp/whatsapp-router.service.js"));
  for (const [token, expect] of [
    ["sup|catnone", /профиль/i],
    ["sup|cat|gazelle|true", /профиль/i],
    ["nonsense|whatever", /напишите/i],
  ]) {
    const sent = [];
    const svc = Object.create(WhatsAppRouterService.prototype);
    svc.whatsapp = { sendText: async (_p, body) => sent.push(body) };
    svc.logger = { log() {}, warn() {}, error() {} };
    await svc.handleToken("chat", "+77076729687", token, "ru");
    check(sent.length > 0, `на кнопку «${token}» бот промолчал`);
    check(expect.test(sent.join("\n")), `на «${token}» ответ без подсказки: «${sent.join(" ")}»`);
  }
}

export default { name: "вопрос поставщика", checked, failures };
