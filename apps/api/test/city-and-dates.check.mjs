/**
 * Город внутри фразы, молчание вместо ложной жалобы и местная дата.
 *
 * Три находки прогона 2 сентября.
 *
 * 31 августа человек написал «г Семей область Абай», затем «Семей и пригород
 * до 150км от него» — и дважды услышал «Не узнал город». Семей есть в
 * справочнике, там двое наших исполнителей.
 *
 * Тем же ответом отвечали на «на фото кроме шкафов все разобрано» и
 * «передайте мои смс оператору»: первое сообщение оседало в поле города, и
 * человек получал список городов вместо ответа.
 *
 * А кнопка «Сегодня» в 04:16 по Астане предлагала вчерашнее число: дата
 * бралась по Гринвичу.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const shared = path.resolve(here, "../../../packages/shared/dist/cities.js");
const { resolveCityList, looksLikeCityAnswer } = require(shared);
const { isoDateInTimezone, isoDatePlusDays } = require(path.resolve(here, "../dist/common/local-date.util.js"));

const failures = [];
let checked = 0;
const check = (ok, what) => {
  checked++;
  if (!ok) failures.push(what);
};

// ── Город внутри фразы ─────────────────────────────────────────────────────
for (const [text, want] of [
  // Реплики из переписки 31 августа, дословно
  ["г Семей область Абай", "Семей"],
  ["Семей и пригород до 150км от него.", "Семей"],
  ["Работаю по Астане и области", "Астана"],
  ["город Караганда", "Караганда"],
  // Прежнее поведение не сломано
  ["Астана", "Астана"],
  ["Астана, Караганда", "Астана,Караганда"],
  ["Астана Алмата", "Астана,Алматы"],
  // Ничего похожего на город — выдумывать нельзя
  ["на фото кроме шкафов все разобрано", ""],
  ["передайте мои смс оператору", ""],
]) {
  checked++;
  const got = resolveCityList(text).cities.map((c) => c.name.ru).join(",");
  if (got !== want) failures.push(`«${text}» → ${got || "ничего"}, ожидалось ${want || "ничего"}`);
}

// Зона выезда сохраняется: её кладут в заметку профиля, а не выбрасывают.
{
  const r = resolveCityList("Семей и пригород до 150км от него.");
  check(r.unresolved.length > 0, "остаток «пригород до 150км» потерян — это зона выезда, а не мусор");
  check(!/семей/i.test(r.unresolved.join(" ")), `в остатке осталось само название города: ${JSON.stringify(r.unresolved)}`);
}

// ── Жаловаться только на настоящую попытку назвать город ───────────────────
for (const [text, want] of [
  // Так человек называет город — значит список городов уместен
  ["Кокшетау", true],
  ["Усть-Каменогорск", true],
  ["г Семей", true],
  // А это не ответ про город: список в ответ читается как «тебя не слушают»
  ["на фото кроме шкафов все разобрано", false],
  ["передайте мои смс оператору", false],
  ["У меня", false],
  ["Нужно вывезти строительный мусор после ремонта", false],
  // Короткий заказ — тоже не ответ про город: «Нужен автокран» в поле
  // города встречался на стенде, и список городов в ответ был неуместен.
  ["Нужен автокран", false],
  ["Нужна газель", false],
  ["Автокран керек", false],
]) {
  checked++;
  if (looksLikeCityAnswer(text) !== want) {
    failures.push(`«${text}»: ${want ? "не признано попыткой назвать город" : "принято за название города"}`);
  }
}

// ── Дата по местному времени ───────────────────────────────────────────────
{
  // Момент, на котором это и поймали: 04:16 в Астане — уже 2 сентября,
  // тогда как по Гринвичу ещё 1-е.
  const night = new Date("2026-09-01T23:16:00Z");
  check(
    isoDateInTimezone(night) === "2026-09-02",
    `ночью «сегодня» посчитано как ${isoDateInTimezone(night)} вместо 2026-09-02`,
  );
  check(
    isoDatePlusDays(1, night) === "2026-09-03",
    `«завтра» ночью посчитано как ${isoDatePlusDays(1, night)} вместо 2026-09-03`,
  );
  check(
    isoDatePlusDays(2, night) === "2026-09-04",
    `«послезавтра» ночью посчитано как ${isoDatePlusDays(2, night)}`,
  );
  // Днём расхождения нет — проверка не должна «чинить» то, что и так верно.
  const day = new Date("2026-09-02T09:00:00Z");
  check(isoDateInTimezone(day) === "2026-09-02", "днём дата посчитана неверно");
  // Переход через конец месяца
  check(isoDatePlusDays(1, new Date("2026-09-30T10:00:00Z")) === "2026-10-01", "сдвиг через конец месяца сломан");
}

// ── «Послезавтра» не должно превращаться в «завтра» ───────────────────────
{
  const { MockAiProvider } = require(path.resolve(here, "../dist/ai/mock-ai.provider.js"));
  const provider = new MockAiProvider();
  const field = [{ key: "date", type: "date", required: true, label: { ru: "Дата", kk: "" }, question: { ru: "", kk: "" } }];
  const today = isoDateInTimezone();
  const cases = [
    ["сегодня", today],
    ["завтра", isoDatePlusDays(1)],
    ["послезавтра", isoDatePlusDays(2)],
  ];
  for (const [text, want] of cases) {
    checked++;
    const out = await provider.extractFields(text, field, {});
    if (out.date !== want) failures.push(`«${text}» разобрано как ${out.date}, ожидалось ${want}`);
  }
}

export default { name: "город и даты", checked, failures };
