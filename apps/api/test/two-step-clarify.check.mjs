/**
 * Уточнение заявки в два шага: «где и когда» одним вопросом, затем карточка.
 *
 * Обязательных полей у всех тринадцати категорий ровно два — город и дата, —
 * но спрашивались они по одному, и путь от «нужен вывоз мусора» до карточки
 * занимал три хода. За два месяца 53 заявки закрылись с причиной «данные не
 * уточнены больше 24 ч»: это больше, чем по всем остальным причинам вместе.
 * За неделю 21–28 октября из 13 созданных заявок до исполнителей дошли 4.
 *
 * Проверяется: пара город+дата уходит одним вопросом; когда одно из двух уже
 * известно, второе спрашивается обычным вопросом (с кнопками, а не шаблоном);
 * необязательные поля в вопрос не попадают; существующие combineGroup
 * продолжают работать; объединённый вопрос рисуется текстовым примером.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");

const { nextQuestionFields } = require(path.join(dist, "ai/field-completion.util.js"));
const { buildQuestionText } = require(path.join(dist, "orders/order-derive.util.js"));
const { renderFieldQuestion } = require(path.join(dist, "whatsapp/whatsapp-message-render.util.js"));

const failures = [];
let checked = 0;
const check = (ok, what) => {
  checked++;
  if (!ok) failures.push(what);
};

// Поля как у «Вывоза строительного мусора» на проде: порядок и
// обязательность — те же, иначе проверка ничего не говорит о реальности.
const FIELDS = [
  { key: "city", type: "text", required: true, label: { ru: "Город", kk: "Қала" }, question: { ru: "В каком городе нужна услуга?", kk: "Қызмет қай қалада керек?" } },
  { key: "needLoaders", type: "boolean", required: false, label: { ru: "Нужны грузчики", kk: "Тиеушілер керек пе" }, question: { ru: "Нужны ли грузчики?", kk: "Тиеушілер керек пе?" } },
  { key: "date", type: "date", required: true, label: { ru: "Дата", kk: "Күні" }, question: { ru: "На какую дату нужен вывоз?", kk: "Шығару қай күнге керек?" } },
  { key: "time", type: "time", required: false, label: { ru: "Время", kk: "Уақыт" }, question: { ru: "В какое время удобно?", kk: "Қай уақыт ыңғайлы?" } },
  { key: "address", type: "address", required: false, label: { ru: "Адрес", kk: "Мекенжай" }, question: { ru: "Укажите адрес.", kk: "Мекенжайды көрсетіңіз." } },
];

// ── 1. Шаг первый: где и когда — одним вопросом ────────────────────────────
{
  const q = nextQuestionFields(FIELDS, {});
  check(q.length === 2, `первый вопрос спрашивает ${q.length} поле(й) вместо двух — путь к карточке снова длиннее`);
  check(
    q.map((f) => f.key).join(",") === "city,date",
    `в первом вопросе ожидались город и дата, пришло: ${q.map((f) => f.key).join(",") || "ничего"}`,
  );
  const text = buildQuestionText(q, "ru");
  check(/город/i.test(text) && /дат/i.test(text), `в тексте вопроса потерялся город или дата: «${text}»`);
}

// ── 2. Шаг второй: больше спрашивать нечего ────────────────────────────────
{
  const q = nextQuestionFields(FIELDS, { city: "Астана", date: "2026-10-29" });
  check(q.length === 0, "после города и даты бот снова что-то спрашивает — второй шаг должен быть карточкой");
}

// ── 3. Необязательные поля в вопрос не лезут ───────────────────────────────
{
  const q = nextQuestionFields(FIELDS, { city: "Астана", date: "2026-10-29", time: undefined });
  check(q.length === 0, "спрашиваем необязательное поле — адрес и время исполнитель уточнит по телефону");
}

// ── 4. Когда известно одно из пары — обычный вопрос с кнопками ─────────────
{
  const onlyDate = nextQuestionFields(FIELDS, { city: "Астана" });
  check(onlyDate.length === 1 && onlyDate[0].key === "date", "город известен — остаётся спросить только дату");
  const rendered = renderFieldQuestion(onlyDate, "На какую дату нужен вывоз?", "ru");
  check(
    !/Напишите ответ одним сообщением/.test(rendered.body),
    "одиночный вопрос отрисован шаблоном для пары — пропали кнопки «сегодня/завтра»",
  );

  const onlyCity = nextQuestionFields(FIELDS, { date: "2026-10-29" });
  check(onlyCity.length === 1 && onlyCity[0].key === "city", "дата известна — остаётся спросить только город");
}

// ── 5. Объединённый вопрос показывает, как отвечать ────────────────────────
{
  const q = nextQuestionFields(FIELDS, {});
  const rendered = renderFieldQuestion(q, buildQuestionText(q, "ru"), "ru");
  check(
    /Напишите ответ одним сообщением/.test(rendered.body),
    "у парного вопроса нет подсказки, как ответить одним сообщением — человек ответит только на половину",
  );
  check(/Город: Астана/.test(rendered.body) === false, "в примере подставлен реальный город вместо образца");
  check(/Город:/.test(rendered.body) && /Дата:/.test(rendered.body), "в примере ответа нет обоих полей");
  check(rendered.buttons === undefined, "к парному вопросу прицепились кнопки — отвечать на два поля ими нельзя");
}

// ── 6. Старые combineGroup не сломались ────────────────────────────────────
{
  const moving = [
    { key: "addressFrom", type: "address", required: true, combineGroup: "addresses", label: { ru: "Откуда", kk: "Қайдан" }, question: { ru: "Откуда забрать?", kk: "Қайдан алу керек?" } },
    { key: "addressTo", type: "address", required: true, combineGroup: "addresses", label: { ru: "Куда", kk: "Қайда" }, question: { ru: "Куда доставить?", kk: "Қайда жеткізу керек?" } },
    { key: "city", type: "text", required: true, label: { ru: "Город", kk: "Қала" }, question: { ru: "В каком городе?", kk: "Қай қалада?" } },
  ];
  const q = nextQuestionFields(moving, {});
  check(
    q.map((f) => f.key).join(",") === "addressFrom,addressTo",
    `группа адресов перестала работать: ${q.map((f) => f.key).join(",")}`,
  );
}

// ── 7. Чувствительность: без правила пара распадается ──────────────────────
{
  // Повторяем прежнее поведение (только combineGroup) и убеждаемся, что оно
  // даёт один вопрос — иначе проверка 1 проходила бы и без нашей правки.
  const missing = FIELDS.filter((f) => f.required);
  const asBefore = missing[0].combineGroup
    ? missing.filter((f) => f.combineGroup === missing[0].combineGroup).slice(0, 2)
    : [missing[0]];
  check(asBefore.length === 1, "подмена не состоялась: прежняя логика тоже вернула пару, проверка ничего не стережёт");
  check(asBefore[0].key === "city", "прежняя логика спрашивала не город — набор полей в тесте разошёлся с продом");
}

export default { name: "уточнение в два шага", checked, failures };
