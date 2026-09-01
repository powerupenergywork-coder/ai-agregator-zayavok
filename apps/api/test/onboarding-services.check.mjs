/**
 * Регистрация спрашивает словами, а кнопками добирает только непонятое.
 *
 * До 2 сентября шаг категорий был перебором: один вопрос «Да/Нет» на каждую.
 * На шести категориях это девять шагов анкеты, а с тремя новыми стало бы
 * двенадцать — при том что человек называет свою технику в первом же
 * сообщении, и мы её игнорировали.
 *
 * Здесь проверяется главное свойство: тот, кто ответил словами, кнопок про
 * категории не видит вовсе, а тот, чьи слова мы не разобрали, видит их все.
 * И отдельно — что из нового шага есть выход: круг вопросов без выхода мы уже
 * проходили дважды (Жарбол 28 августа, отказ от всех категорий).
 */
import { makeOnboarding } from "./lib/onboarding-harness.mjs";

const chatId = "77010000009@c.us";
const phone = "+77010000009";
const text = (t) => ({ text: t });
const button = (id) => ({ buttonReplyId: id, text: undefined });

const failures = [];
let checked = 0;
const check = (ok, what) => {
  checked++;
  if (!ok) failures.push(what);
};

/** Прогон с самого начала: возвращает стенд и всё сказанное человеку. */
async function run(...messages) {
  const stand = makeOnboarding();
  await stand.service.start(chatId, phone, "ru");
  for (const m of messages) await stand.service.handleIncoming(chatId, phone, m, "ru");
  return { ...stand, joined: stand.sent.map((m) => m.body ?? "").join("\n---\n") };
}

/** Спрашивали ли «Вы предоставляете услугу …?» — то есть дошло ли до перебора. */
const askedButtons = (joined) => /Вы предоставляете услугу/.test(joined);

// ── Назвал технику словами: перебора нет ───────────────────────────────────
{
  const { joined, sent } = await run(text("Асхат"), text("Самосвал"));
  check(!askedButtons(joined), "после ответа словами всё равно начался перебор кнопками");
  check(/Записал: Самосвал/.test(joined), `не подтвердили, что записали: «${joined.slice(-140)}»`);
  const last = sent[sent.length - 1];
  check(last?.kind === "buttons", "подтверждение пришло без кнопок «есть ещё» / «это всё»");
}

// ── Несколько услуг в одной фразе ──────────────────────────────────────────
{
  const { joined } = await run(text("Асхат"), text("Самосвал и манипулятор"));
  check(/Самосвал/.test(joined) && /Манипулятор/.test(joined), `распознана не вся фраза: «${joined.slice(-140)}»`);
  check(!askedButtons(joined), "перебор начался, хотя обе услуги названы");
}
{
  const { joined } = await run(text("Асхат"), text("самосвал, грузчики"));
  check(/Самосвал/.test(joined) && /Грузчики/.test(joined), `перечисление через запятую разобрано не полностью: «${joined.slice(-140)}»`);
}

// ── «Это всё» ведёт к городам, минуя категории ─────────────────────────────
{
  const { joined } = await run(text("Асхат"), text("Самосвал"), button("sup|svc|done"));
  check(/В каких городах/.test(joined), "после «это всё» не спросили города");
  check(!askedButtons(joined), "после «это всё» всплыл перебор");
}

// ── «Есть ещё» добавляет, а не заменяет ────────────────────────────────────
{
  const { joined, db } = await run(
    text("Асхат"),
    text("Самосвал"),
    button("sup|svc|more"),
    text("Автокран"),
    button("sup|svc|done"),
    text("Астана"),
    button("sup|urgent|true"),
    button("sup|hours|true"),
    button("sup|confirm|yes"),
  );
  check(/Что ещё делаете/.test(joined), "на «есть ещё» не спросили, что именно");
  check(
    db.categorySlugs.includes("samosval") && db.categorySlugs.includes("avtokran"),
    `вторая услуга затёрла первую: записано ${JSON.stringify(db.categorySlugs)}`,
  );
}

// ── Слова не разобрали — вот тут кнопки и нужны ────────────────────────────
{
  const { joined } = await run(text("Асхат"), text("Спецтехника"));
  check(askedButtons(joined), "непонятый ответ не увёл на уточнение кнопками");
  check(/записал/i.test(joined), "сказанное человеком не подтвердили — выглядит, будто его не услышали");
}

// ── Выход есть всегда: свободный шаг не крутится по кругу ──────────────────
{
  // Три распознанных ответа подряд: на третьем спрашивать «ещё?» уже незачем.
  const { joined } = await run(
    text("Асхат"),
    text("Самосвал"),
    button("sup|svc|more"),
    text("Автокран"),
    button("sup|svc|more"),
    text("Газель"),
  );
  check(/В каких городах/.test(joined), `после трёх ответов не вышли к городам: «${joined.slice(-160)}»`);
}

// ── Регистрация доходит до конца коротким путём ────────────────────────────
{
  const { db, joined } = await run(
    text("Асхат"),
    text("Самосвал"),
    button("sup|svc|done"),
    text("Астана"),
    button("sup|urgent|true"),
    button("sup|hours|false"),
    button("sup|confirm|yes"),
  );
  check(db.categorySlugs.includes("samosval"), `категория не сохранена: ${JSON.stringify(db.categorySlugs)}`);
  check(db.cities.includes("Астана"), `город не сохранён: ${JSON.stringify(db.cities)}`);
  check(!askedButtons(joined), "короткий путь всё-таки показал перебор категорий");
}

export default { name: "регистрация словами", checked, failures };
