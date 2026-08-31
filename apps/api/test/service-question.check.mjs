/**
 * Вопрос о сервисе против настоящего ответа — на каждом шаге регистрации.
 *
 * Здесь цена ложного срабатывания выше, чем пропуска. Пропустили вопрос —
 * человек переспросит. Приняли ответ за вопрос — он получит лекцию вместо
 * движения по шагам, и это ровно то зацикливание, от которого мы уходили.
 *
 * Отдельно проверяется, что знак вопроса сам по себе ничего не значит:
 * «Манипулятор?» на шаге категорий — это ответ.
 */
import { readCompiled, buildScope } from "./lib/source.mjs";
import { makeOnboarding } from "./lib/onboarding-harness.mjs";

const src = readCompiled("whatsapp/whatsapp-onboarding.service.js");
const { SERVICE_QUESTION_RE } = buildScope(src, ["SERVICE_QUESTION_RE"]);

const failures = [];
let checked = 0;
const check = (ok, what) => {
  checked++;
  if (!ok) failures.push(what);
};

// ── Вопросы о сервисе: обязаны срабатывать ─────────────────────────────────
for (const q of [
  // Реплика человека 30 августа, дословно
  "Да, меня это заинтересовало. У меня категории B и C. Мне нужна работа. Вам нужен водитель?",
  "Вам нужен водитель?",
  "Нужны водители?",
  "Требуются водители",
  "Вы берёте на работу?",
  "Вы нанимаете?",
  "Есть вакансии?",
  "Какая зарплата?",
  "Какой оклад",
  "Какая у вас комиссия?",
  "Сколько берёте с заказа",
  "Это платно?",
  "Нужно ли платить?",
  "Что это за сервис?",
  "Что это такое",
  "Как вы работаете?",
  "Как это устроено",
  "Откуда у вас заявки?",
  "Қалай жұмыс істейсіздер?",
]) {
  check(SERVICE_QUESTION_RE.test(q), `вопрос о сервисе не узнан: «${q}»`);
}

// ── Настоящие ответы: срабатывать НЕ должны ────────────────────────────────
for (const a of [
  // Имя
  "Асхат",
  "ТОО Стройтех",
  "Жарбол",
  // Категории — знак вопроса тут ничего не значит
  "Манипулятор?",
  "Самосвал",
  "Самосвал 25 тонн",
  "Услуги самосвала 25 тонн город Астана",
  "нет не газель",
  "Минипогрузчик",
  "моей нет в списке",
  // Города
  "Астана",
  "Астана, Караганда",
  "Астана?",
  "Работаю по Астане и области",
  // Прочее
  "да",
  "нет",
  "поставщик",
  "Круглосуточно",
  // Соседние темы, но не о сервисе
  "Работаю на самосвале",
  "Ищу заказы на манипулятор",
]) {
  check(!SERVICE_QUESTION_RE.test(a), `ответ принят за вопрос о сервисе: «${a}»`);
}

// ── Поведение на каждом шаге: пояснение и возврат к тому же вопросу ────────
const chatId = "77088891256@c.us";
const phone = "+77088891256";
const text = (t) => ({ text: t });
const button = (id) => ({ buttonReplyId: id, text: undefined });

/** Довести регистрацию до нужного шага и задать вопрос о сервисе. */
async function askAtStep(stepName, warmup) {
  const { service, sent } = makeOnboarding();
  await service.start(chatId, phone, "ru");
  for (const m of warmup) await service.handleIncoming(chatId, phone, m, "ru");
  const questionBefore = sent[sent.length - 1]?.body ?? "";
  sent.length = 0;
  await service.handleIncoming(chatId, phone, text("Вам нужен водитель?"), "ru");
  const out = sent.map((m) => m.body ?? "");
  return { out, questionBefore, joined: out.join("\n---\n") };
}

const cases = [
  ["имя", []],
  ["категории", [text("Асхат")]],
  ["своя техника словами", [text("Асхат"), button("sup|catnone")]],
  [
    "города",
    [
      text("Асхат"),
      button("sup|cat|avtokran|false"),
      button("sup|cat|gazelle|false"),
      button("sup|cat|gruzchiki|false"),
      button("sup|cat|manipulyator|false"),
      button("sup|cat|samosval|true"),
      button("sup|cat|construction-waste|false"),
    ],
  ],
];

/**
 * Сам вопрос — последняя непустая строка сообщения.
 *
 * На первом шаге вопрос про имя приходит хвостом длинного вступления («что
 * будем присылать», «комиссию не берём»). Повторять вступление целиком не
 * надо — человек его уже прочитал, — поэтому сравниваем вопрос, а не блок.
 */
const question = (body) =>
  String(body ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop() ?? "";

for (const [label, warmup] of cases) {
  const { out, questionBefore, joined } = await askAtStep(label, warmup);
  check(/не нанимаем на работу/i.test(joined), `шаг «${label}»: пояснение не отправлено`);
  const asked = question(out[out.length - 1]);
  check(
    asked === question(questionBefore),
    `шаг «${label}»: после пояснения спросили «${asked}» вместо «${question(questionBefore)}»`,
  );
}

export default { name: "вопрос о сервисе", checked, failures };
