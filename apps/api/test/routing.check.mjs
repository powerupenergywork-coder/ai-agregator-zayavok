/**
 * Порядок распознавателей — самый частый класс наших ошибок.
 *
 * Побеждает ПЕРВОЕ совпадение, поэтому порядок проверок это поведение, а не
 * оформление. Четыре инцидента подряд родились именно здесь:
 *
 *   «Верно» уходило в ИИ-экстрактор вместо публикации          (№101)
 *   вопрос о цене перехватывался карточкой заявки              (№129)
 *   «передайте оператору» разбиралось как название города      (№130)
 *   «уже не надо, договорился» рисковало стать отменой         (№137)
 *
 * Проверка двойная. Сначала сверяем порядок, вычитанный из собранного кода, с
 * тем, который здесь объявлен: любая перестановка ветки — осознанное решение,
 * и его придётся отразить тут же. Затем прогоняем настоящие фразы и смотрим,
 * какая ветка сработает первой.
 */
import { readCompiled, buildScope, sliceRegion, extractGuardOrder } from "./lib/source.mjs";

const src = readCompiled("whatsapp/whatsapp-router.service.js");

const scope = buildScope(src, [
  "ACK_RE",
  "ACK_WORDS",
  "isAcknowledgement",
  "NEED_RE",
  // OWN_SERVICES — основа NOT_A_CLIENT_RE, без неё выражение не собирается.
  "OWN_SERVICES",
  "NOT_A_CLIENT_RE",
  "looksLikeSupplierDeclaration",
  "FOUND_EXECUTOR_RE",
  "ENOUGH_CALLS_RE",
  "CLIENT_CANCEL_RE",
  "PRICE_QUESTION_RE",
  "WANTS_HUMAN_RE",
  "WORK_SEEKER_RE",
  "PROFESSION_RE",
  "GREETING_RE",
  "AD_CLICK_TOKEN_RE",
]);

// ── Ветка «клиент пишет по разосланной заявке» ──────────────────────────────
//
// Здесь цена ошибки выше всего: ветки закрывают заявку и рассылают
// исполнителям, причём по-разному.
const PUBLISHED_ORDER = [
  ["FOUND_EXECUTOR_RE", "сделка"],
  ["ENOUGH_CALLS_RE", "пауза рассылки"],
  ["CLIENT_CANCEL_RE", "отказ"],
  ["PRICE_QUESTION_RE", "ответ о цене"],
  ["isAcknowledgement", "короткое подтверждение"],
];

// Опора не должна упоминать конкретную ветку: если она окажется не первой —
// а это ровно то, что мы ловим, — участок просто не найдётся, и тест упадёт с
// невнятной жалобой на разметку вместо понятного «порядок разошёлся».
const publishedRegion = sliceRegion(src, 'dto.status === "PUBLISHED"', "markOutcomeAsked");

// ── Глобальные перехваты: работают на любом шаге разговора ─────────────────
const GLOBAL_ORDER = [
  ["AD_CLICK_TOKEN_RE", "код клика"],
  ["WANTS_HUMAN_RE", "передать человеку"],
  ["looksLikeSupplierDeclaration", "это исполнитель"],
  ["WORK_SEEKER_RE", "ищет работу"],
  ["PROFESSION_RE", "назвал профессию"],
  ["GREETING_RE", "поздоровался"],
];

// Участок берём от МЕСТА ПРИМЕНЕНИЯ, а не от объявления: между объявлениями
// вверху файла и веткой разбора лежит половина модуля, и порядок там другой.
const globalRegion = sliceRegion(
  src,
  "msg.text.match(AD_CLICK_TOKEN_RE)",
  'buttonReplyId?.startsWith("who|")',
);

const cases = [];
const fail = [];

function checkOrder(label, region, expected) {
  const names = expected.map(([n]) => n);
  const actual = extractGuardOrder(region, names);
  const same = actual.length === names.length && actual.every((n, i) => n === names[i]);
  cases.push(label);
  if (!same) {
    fail.push(
      `${label}: порядок в коде разошёлся с ожидаемым\n` +
        `   в коде:    ${actual.join(" → ") || "(ничего не найдено)"}\n` +
        `   ожидалось: ${names.join(" → ")}`,
    );
  }
}

checkOrder("порядок веток по разосланной заявке", publishedRegion, PUBLISHED_ORDER);
checkOrder("порядок глобальных перехватов", globalRegion, GLOBAL_ORDER);

/** Какая ветка сработает первой на этой фразе. */
function route(text, order) {
  const t = text.trim();
  for (const [name, label] of order) {
    const guard = scope[name];
    const hit = typeof guard === "function" ? guard(t) : guard.test(t);
    if (hit) return label;
  }
  return "вопрос об исходе";
}

// ── Фразы из настоящих переписок ────────────────────────────────────────────
const PUBLISHED_CASES = [
  // Спорные пары: ради них порядок и зафиксирован
  ["уже не надо, договорился", "сделка"],
  ["всё решил", "сделка"],
  ["готово", "сделка"],
  ["хватит звонков", "пауза рассылки"],
  ["достаточно", "пауза рассылки"],
  ["Всё ненада", "отказ"],
  ["не надо", "отказ"],
  ["отмена", "отказ"],
  ["передумал", "отказ"],
  // Вопросы, на которые надо отвечать, а не закрывать заявку
  ["Мне нужна цена", "ответ о цене"],
  ["Цену кто напишет", "ответ о цене"],
  ["сколько стоит", "ответ о цене"],
  ["спасибо", "короткое подтверждение"],
  ["ок", "короткое подтверждение"],
  // Ничему не соответствует — только тогда спрашиваем об исходе
  ["когда позвонят", "вопрос об исходе"],
  ["Сухие смеси, вес 70кг", "вопрос об исходе"],
  ["грузчики не нужны", "вопрос об исходе"],
  ["мне не надо грузчиков", "вопрос об исходе"],
];

const GLOBAL_CASES = [
  ["Нужен вывоз мусора #K7M2P", "код клика"],
  ["передайте мои смс оператору", "передать человеку"],
  ["позовите оператора", "передать человеку"],
  ["нужен живой человек", "передать человеку"],
  ["я исполнитель, у меня самосвал", "это исполнитель"],
  ["Здравствуйте!", "поздоровался"],
  // Заказчик не должен попасть ни в один перехват
  ["Нужен вывоз строительного мусора, Астана", "дальше по сценарию"],
  ["Астана", "дальше по сценарию"],
  ["27 августа", "дальше по сценарию"],
];

for (const [text, expected] of PUBLISHED_CASES) {
  const got = route(text, PUBLISHED_ORDER);
  cases.push(text);
  if (got !== expected) fail.push(`«${text}» → ${got}, ожидалось ${expected}`);
}

for (const [text, expected] of GLOBAL_CASES) {
  const order = GLOBAL_ORDER.filter(([n]) => n !== "AD_CLICK_TOKEN_RE");
  const hasToken = scope.AD_CLICK_TOKEN_RE.test(text);
  const got = hasToken ? "код клика" : routeGlobal(text, order);
  cases.push(text);
  if (got !== expected) fail.push(`«${text}» → ${got}, ожидалось ${expected}`);
}

function routeGlobal(text, order) {
  for (const [name, label] of order) {
    const guard = scope[name];
    const hit = typeof guard === "function" ? guard(text) : guard.test(text);
    if (hit) return label;
  }
  return "дальше по сценарию";
}

export default { name: "порядок распознавателей", checked: cases.length, failures: fail };
