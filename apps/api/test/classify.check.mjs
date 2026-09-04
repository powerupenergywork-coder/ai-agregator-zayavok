/**
 * Классификация по ключевым словам — запасной путь, когда OpenAI недоступен.
 *
 * Три новые категории добавлены 2 сентября, и одна из них ломает старую
 * механику: «погрузчик» содержит «грузчик». Простое includes давало балл и
 * технике, и бригаде грузчиков, а при ничьей побеждала та категория, которая
 * раньше пришла из базы — то есть заявка уходила не туда в зависимости от
 * порядка строк в таблице.
 *
 * Поэтому категории здесь перечислены в ДВУХ порядках: если проверка ловит
 * подмену только в одном, значит ничья осталась и просто повезло.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
require("reflect-metadata");
const { MockAiProvider } = require(path.join(dist, "ai/mock-ai.provider.js"));

const SLUGS = [
  "gazelle",
  "dump-truck",
  "crane-truck",
  "crane",
  "construction-waste",
  "loaders",
  "aerial-platform",
  "front-loader",
  "disinfection",
  "electrician",
  "plumber",
  "cleaning",
  "tow-truck",
];

const provider = new MockAiProvider();
const failures = [];
let checked = 0;

/** Прогон в обоих порядках категорий: ничья не должна решаться порядком. */
async function expect(message, want) {
  for (const order of [SLUGS, [...SLUGS].reverse()]) {
    checked++;
    const cats = order.map((slug) => ({ slug, name: slug, examples: [] }));
    const got = await provider.classify(message, cats);
    const slug = got?.slug ?? null;
    if (slug !== want) {
      failures.push(`«${message}» → ${slug ?? "ничего"}, ожидалось ${want ?? "ничего"}`);
      break;
    }
  }
}

// ── Ради чего всё затевалось: техника против бригады ───────────────────────
await expect("Нужен фронтальный погрузчик убрать снег во дворе", "front-loader");
await expect("нужен погрузчик", "front-loader");
await expect("Погрузчик загрузить грунт", "front-loader");
// Грузчики остались при своём
await expect("Нужны грузчики на переезд", "loaders");
await expect("нужен грузчик", "loaders");

// ── Автовышка ──────────────────────────────────────────────────────────────
await expect("Нужна автовышка обрезать деревья", "aerial-platform");
await expect("нужна вышка повесить вывеску", "aerial-platform");
await expect("Автовышку на завтра", "aerial-platform");
// Автокран — не вышка, хотя техника соседняя
await expect("Нужен автокран", "crane");

// ── Дезинфекция ────────────────────────────────────────────────────────────
await expect("Нужно потравить тараканов в квартире", "disinfection");
await expect("обработка от клопов", "disinfection");
await expect("дезинфекция офиса", "disinfection");
await expect("дератизация склада", "disinfection");

// ── Старые категории не сдвинулись ─────────────────────────────────────────
await expect("Нужна газель перевезти мебель", "gazelle");
await expect("Нужен самосвал вывезти грунт", "dump-truck");
await expect("Нужен манипулятор", "crane-truck");
await expect("Вывезти строительный мусор", "construction-waste");

// ── Четыре бытовые услуги, добавлены 4 сентября ────────────────────────────
await expect("Нужен электрик поменять розетки", "electrician");
await expect("Не работает свет, нет света в квартире", "electrician");
await expect("Нужен сантехник", "plumber");
await expect("Засор в трубе на кухне", "plumber");
await expect("Нужна уборка квартиры после ремонта", "cleaning");
await expect("Помыть окна в офисе", "cleaning");
await expect("Нужен эвакуатор, машина не заводится", "tow-truck");
await expect("Отбуксировать авто в сервис", "tow-truck");

// ── Два места, где новые категории спорят со старыми ───────────────────────
//
// «Кран» принадлежит автокрану и весит там больше. Сантехнический кран
// узнаётся только в связке — иначе «течёт кран» уехало бы к крановщикам.
await expect("Течёт кран на кухне", "plumber");
await expect("течет кран", "plumber");
await expect("Нужен автокран", "crane");
await expect("Нужен кран поднять груз", "crane");

// «Уборк» есть и у клининга, и у снега. Без связок «уборка снега» уходила бы
// к мойщикам окон, а трактор ждал бы напрасно.
await expect("Уборка снега во дворе", "front-loader");
await expect("Убрать снег с территории базы", "front-loader");
await expect("Генеральная уборка офиса", "cleaning");

// ── Ни на что не похоже — лучше ничего, чем наугад ─────────────────────────
await expect("Здравствуйте", null);
await expect("Астана", null);

export default { name: "классификация по словам", checked, failures };
