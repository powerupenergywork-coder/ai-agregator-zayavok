/**
 * Четыре правки по переписке 30 августа — 13 сентября.
 *
 * 1. Богатое первое сообщение от незнакомого номера — это заявка, а не повод
 *    спросить «вы клиент или исполнитель». +7 701 840 65 70, 11 сентября:
 *    «Астана, ЖК ИНФИНИТИ 1. Нужно вывезти диван. Просьба подсказать
 *    стоимость» — получил вопрос «кто вы» и не ответил.
 * 2. Уточнение к готовой карточке меняет заявку. Заявка №188: «Газель
 *    непойдет», «Обьем большой» — та же карточка, потом «я вас не понимаю»,
 *    и четырнадцать исполнителей без слова про объём. Заявка №179: «Левый
 *    берег» затёр Астану. Заявка №186: «Не строительный» — та же карточка.
 * 3. Ответ исполнителя по открытой заявке — не всегда «Записал». Берик,
 *    заявка №183: «Заказ выполнил», «Других заказов есть у вас», «Заказ
 *    есть» — шесть одинаковых «Записал по заявке №183» подряд.
 * 4. Мелочи оттуда же: «Нашла» как исход, бессмысленная расшифровка
 *    голосового в профиле, оповещение владельцу до разбора сообщения.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCompiled, buildScope, extractDeclaration } from "./lib/source.mjs";

const require = createRequire(import.meta.url);
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
require("reflect-metadata");

const failures = [];
let checked = 0;
const check = (ok, what) => {
  checked++;
  if (!ok) failures.push(what);
};

const routerSrc = readCompiled("whatsapp/whatsapp-router.service.js");
const ordersSrc = readCompiled("orders/orders.service.js");
const shared = require(path.resolve(dist, "../../../packages/shared/dist/index.js"));

// ── 1. Первое сообщение: заявка или «кто вы» ───────────────────────────────
{
  // looksLikeServiceRequest зовёт findCitiesInText из shared — подставляем
  // настоящий модуль, а не копию.
  const body = ["NEED_RE", "TASK_RE", "PLACE_RE", "looksLikeServiceRequest"]
    .map((n) => extractDeclaration(routerSrc, n))
    .join("\n");
  // eslint-disable-next-line no-new-func
  const { looksLikeServiceRequest } = new Function("shared_1", `${body}\nreturn { looksLikeServiceRequest };`)(shared);

  for (const [text, want] of [
    // Реплики, потерянные 9 и 11 сентября, — после отрезанного приветствия
    ["Астана, ЖК ИНФИНИТИ 1. Нужно вывезти диван. Просьба подсказать стоимость", true],
    ["вывоз мусора после ремонта квартиры, 3 этаж, без лифта. 5 дверей межкомнатные с обналичкой, ванна, унитаз", true],
    ["нужен манипулятор 10 тонн, Астана, завтра", true],
    ["перевезти вещи, Караганда", true],
    ["демонтировать кухню, ул. Абая 10", true],
    // Не заявка
    ["Ищу работу водителем", false],
    ["по ценам сами да", false],
    ["Работаю по Астане, есть газель", false],
    ["", false],
    ["Как дела", false],
  ]) {
    checked++;
    if (looksLikeServiceRequest(text) !== want) {
      failures.push(`первое сообщение «${text.slice(0, 50)}»: ${want ? "не признано заявкой" : "ошибочно признано заявкой"}`);
    }
  }
}

// ── 3а. Просьба о работе в любом порядке слов ──────────────────────────────
{
  const { MORE_ORDERS_RE } = buildScope(routerSrc, ["MORE_ORDERS_RE"]);
  for (const [text, want] of [
    // Берик, 12 сентября, дословно
    ["Других заказов есть у вас", true],
    ["Заказ есть", true],
    ["Еще заявка есть", true],
    ["есть ещё заказы", true],
    ["Новые заявки есть?", true],
    ["Заказ выполнил", false],
    ["Беру заявку", false],
    ["Не берут телефон", false],
  ]) {
    checked++;
    if (MORE_ORDERS_RE.test(text) !== want) failures.push(`просьба о работе «${text}»: распознана неверно`);
  }
}

// ── 3б. Исходы «выполнил» и «клиент нашёл сам» ─────────────────────────────
{
  const { DONE_RE, CLIENT_FOUND_ELSEWHERE_RE } = buildScope(routerSrc, ["DONE_RE", "CLIENT_FOUND_ELSEWHERE_RE"]);
  for (const [text, want] of [
    ["Заказ выполнил", true],
    ["Заказ закрыт. Спасибо!", true],
    ["сделали, всё хорошо", true],
    ["Беру заявку", false],
    ["Договорились, завтра в 10", false],
    ["Нашли говорят они сами", false],
  ]) {
    checked++;
    if (DONE_RE.test(text) !== want) failures.push(`исход «выполнил» для «${text}»: распознан неверно`);
  }
  for (const [text, want] of [
    ["Нашли говярят они сами рахмет", true],
    ["клиент уже нашёл", true],
    ["сами нашли", true],
    ["другого взяли", true],
    ["Заказ выполнил", false],
    ["Беру", false],
  ]) {
    checked++;
    if (CLIENT_FOUND_ELSEWHERE_RE.test(text) !== want) failures.push(`исход «нашёл сам» для «${text}»: распознан неверно`);
  }
}

// ── 3в. Что делает recordOrderReply с этими исходами ───────────────────────
{
  const { WhatsAppRouterService } = require(path.join(dist, "whatsapp/whatsapp-router.service.js"));

  function stand({ askedAgo = null } = {}) {
    const sent = [];
    const rows = [];
    const checkins = [];
    let askedAt = askedAgo === null ? null : new Date(Date.now() - askedAgo);
    const svc = Object.create(WhatsAppRouterService.prototype);
    svc.whatsapp = { sendText: async (_p, body) => sent.push(body) };
    svc.logger = { log() {}, warn() {}, error() {} };
    svc.prisma = {
      supplierOrderReply: {
        create: async ({ data }) => rows.push({ ...data, createdAt: new Date() }),
        findFirst: async ({ where }) => {
          const mine = rows.filter((r) => r.orderId === where.orderId && r.supplierId === where.supplierId);
          return mine[mine.length - 1] ?? null;
        },
      },
      notificationLog: { findMany: async () => [{ orderId: "o183" }] },
      order: { findFirst: async () => ({ id: "o183", number: 183 }) },
    };
    svc.newOrderAlert = { alertOrderProblem: async () => {} };
    svc.orders = {
      outcomeAskedAt: async () => askedAt,
      sendCompletionCheckin: async (id) => checkins.push(id),
      markOutcomeAsked: async () => {
        askedAt = new Date();
      },
    };
    return { svc, sent, rows, checkins };
  }

  // «Заказ выполнил» — исход, клиента спрашиваем, живого человека не предлагаем
  {
    const { svc, sent, rows, checkins } = stand();
    const handled = await svc.recordOrderReply("+77057419797", { id: "s1" }, "Заказ выполнил", "ru");
    check(handled === true, "«выполнил» не перехвачено");
    check(rows[0]?.outcome === "done", `исход записан как «${rows[0]?.outcome}», а не «done»`);
    check(checkins.length === 1, "клиента не спросили, всё ли в порядке");
    check(/выполнена/.test(sent.join("\n")), `ответ не про выполнение: «${sent.join(" ")}»`);
    check(!/живой человек/.test(sent.join("\n")), "на «выполнил» снова предложили живого человека");
  }

  // Второй исполнитель написал то же самое через час — клиента не дёргаем
  {
    const { svc, checkins } = stand({ askedAgo: 60 * 60 * 1000 });
    await svc.recordOrderReply("+77057419797", { id: "s2" }, "выполнили", "ru");
    check(checkins.length === 0, "клиента спросили второй раз за час");
  }

  // «Нашли сами» — тоже исход
  {
    const { svc, rows, checkins, sent } = stand();
    await svc.recordOrderReply("+77056318546", { id: "s1" }, "Нашли говярят они сами рахмет", "ru");
    check(rows[0]?.outcome === "client_found_elsewhere", `исход «${rows[0]?.outcome}» вместо «client_found_elsewhere»`);
    check(checkins.length === 1, "по «нашли сами» клиента не спросили");
    check(/нашёл другого/.test(sent.join("\n")), "ответ не о том, что клиент нашёл другого");
  }

  // Два комментария подряд — второй ответ короткий
  {
    const { svc, sent } = stand();
    await svc.recordOrderReply("+77057419797", { id: "s1" }, "Хорошо буду ждать заказы", "ru");
    await svc.recordOrderReply("+77057419797", { id: "s1" }, "Договор", "ru");
    check(/Записал по заявке/.test(sent[0] ?? ""), "первый комментарий не получил полного ответа");
    check(sent[1] === "Принял.", `второй комментарий подряд получил «${sent[1]}» вместо короткого «Принял.»`);
  }

  // Согласие после комментария — полноценный ответ, а не «Принял.»
  {
    const { svc, sent } = stand();
    await svc.recordOrderReply("+77057419797", { id: "s1" }, "Хорошо буду ждать заказы", "ru");
    await svc.recordOrderReply("+77057419797", { id: "s1" }, "Беру заявку", "ru");
    check(/отметил/.test(sent[1] ?? ""), "согласие после комментария ужато до «Принял.»");
  }
}

// ── 4а. «Нашла» — исход, а не разговор ─────────────────────────────────────
{
  const { FOUND_EXECUTOR_RE } = buildScope(routerSrc, ["FOUND_EXECUTOR_RE"]);
  for (const [text, want] of [
    ["Нашла", true],
    ["нашла сама", true],
    ["Нашёл", true],
    ["уже нашли", true],
    ["нашёл исполнителя", true],
    ["Не нашёл никого", false],
    ["Отмените", false],
  ]) {
    checked++;
    if (FOUND_EXECUTOR_RE.test(text) !== want) failures.push(`«${text}»: исход распознан неверно`);
  }
}

// ── 4б. Бессмысленная расшифровка ──────────────────────────────────────────
{
  const { looksLikeGarbledTranscript } = require(path.join(dist, "whatsapp/whatsapp-router.service.js"));
  check(
    looksLikeGarbledTranscript("Оба нашли говорят, оба нашли говядину. Оба нашли девушку говорят, нашли говядину."),
    "расшифровка по кругу принята за речь",
  );
  check(
    !looksLikeGarbledTranscript(
      "А здравствуйте, сколько будет стоить у вас вывоз мусора? Получается, строительный, там, в мешках обои, вот такой кафель. Девятый этаж, лифт работает. Левый берег.",
    ),
    "настоящая речь принята за бессмыслицу",
  );
  check(!looksLikeGarbledTranscript("Заказ закрыт. Спасибо!"), "короткая фраза принята за бессмыслицу");
  check(!looksLikeGarbledTranscript("Так Тактайлар Разные тактайлар Гороховская Салуха Газель"), "семь слов — ещё не повод отбрасывать");
}

// ── 2а. Отказ от категории ─────────────────────────────────────────────────
{
  const { negatesCategory } = buildScope(ordersSrc, ["negatesCategory"]);
  const waste = "Вывоз строительного мусора";
  check(negatesCategory("Не строительный", waste), "«Не строительный» не признано отказом от категории");
  check(negatesCategory("это не строительный мусор", waste), "отказ внутри фразы не распознан");
  check(negatesCategory("Газель не пойдёт", "Газель"), "«газель не пойдёт» при категории Газель не распознано");
  check(!negatesCategory("Газель непойдет", waste), "«газель не пойдёт» при категории «мусор» принято за отказ от категории");
  check(!negatesCategory("пищевой мусор", waste), "уточнение принято за отказ");
  check(!negatesCategory("Обьем большой", waste), "объём принят за отказ от категории");
}

// ── 2б. Уточнение к готовой карточке, район и длинное сообщение ────────────
{
  const { OrdersService } = require(path.join(dist, "orders/orders.service.js"));

  function stand({ known, extracted = {}, description = null } = {}) {
    const state = { fieldsData: { ...known }, description, city: known.city ?? null };
    const updates = [];
    const fields = [
      { key: "city", label: { ru: "Город", kk: "Қала" }, type: "text", required: true, question: { ru: "В каком городе?", kk: "Қай қалада?" } },
      { key: "address", label: { ru: "Адрес", kk: "Мекенжай" }, type: "text", required: true, question: { ru: "Адрес?", kk: "Мекенжай?" } },
    ];
    const category = { id: "c1", slug: "construction-waste", name: { ru: "Вывоз строительного мусора", kk: "Құрылыс қоқысын шығару" }, fields };
    const svc = Object.create(OrdersService.prototype);
    svc.logger = { log() {}, warn() {}, error() {} };
    svc.prisma = {
      order: {
        findUnique: async () => ({ id: "o1", status: "CLARIFYING", categoryId: "c1", fieldsData: state.fieldsData, description: state.description }),
        update: async ({ data }) => {
          updates.push(data);
          if (data.description !== undefined) state.description = data.description;
          if (data.fieldsData) state.fieldsData = data.fieldsData;
          if (data.city !== undefined) state.city = data.city;
          return {};
        },
      },
      chatMessage: { create: async () => ({}), count: async () => 2 },
      serviceArea: { count: async () => 5 },
    };
    svc.categories = { findByIdOrThrow: async () => category, listForClassification: async () => [{ slug: "gazelle", name: "Газель", examples: [] }] };
    svc.ai = { extractFields: async () => extracted };
    svc.toDto = async () => ({});
    return { svc, state, updates };
  }

  const ready = { city: "Астана", address: "Караоткель" };

  // Заявка №188: «Обьем большой» на карточке — в пояснение, карточка меняется
  {
    const { svc, state } = stand({ known: ready });
    const turn = await svc.chatTurn("o1", "Обьем большой", "ru", {});
    check(/Обьем большой/.test(state.description ?? ""), "уточнение к карточке не попало в пояснение");
    check(turn.isReadyForReview === true, "после уточнения карточка перестала быть готовой");
  }

  // Вопрос на карточке — не уточнение
  {
    const { svc, state } = stand({ known: ready });
    await svc.chatTurn("o1", "а сколько это стоит?", "ru", { questionAnswered: true });
    check(!state.description, "вопрос клиента записан в пояснение к заявке");
  }

  // Заявка №186: «Не строительный» — список категорий, а не та же карточка
  {
    const { svc, state } = stand({ known: ready });
    const turn = await svc.chatTurn("o1", "Не строительный", "ru", {});
    check(turn.needsCategoryPick === true, "отказ от категории не привёл к выбору категории");
    check(/Не строительный/.test(state.description ?? ""), "слова отказа не сохранены — исполнитель не узнает, что не так");
  }

  // Заявка №179: «Левый берег» — район, а не новый город
  {
    const { svc, state, updates } = stand({ known: { city: "Астана" }, extracted: { city: "Левый берег" } });
    const turn = await svc.chatTurn("o1", "Левый берег, девятый этаж, лифт работает", "ru", {});
    const last = updates.filter((u) => u.fieldsData).pop();
    check(last?.fieldsData?.city === "Астана", `город стал «${last?.fieldsData?.city}» вместо Астаны`);
    check(/Левый берег/.test(state.description ?? ""), "район не попал в пояснение");
    check(!/Не узнал город/.test(turn.assistantMessage), "клиенту сказали «не узнал город», хотя город известен");
  }

  // Длинное сообщение уходит в пояснение целиком, даже если поле извлечено
  {
    const long = "Сколько будет стоить вывоз мусора? Строительный, в мешках обои, кафель, тридцать зелёных мешков, девятый этаж, лифт работает, левый берег, Астана";
    const { svc, state } = stand({ known: {}, extracted: { city: "Астана" } });
    await svc.chatTurn("o1", long, "ru", {});
    check(/тридцать зелёных мешков/.test(state.description ?? ""), "подробности длинного сообщения потеряны — извлекли только город");
  }
}

// ── 4в. Оповещение владельцу — после разбора первой реплики ────────────────
{
  const { OrdersService } = require(path.join(dist, "orders/orders.service.js"));
  const calls = [];
  const svc = Object.create(OrdersService.prototype);
  svc.prisma = { chatMessage: { count: async () => 0 } };
  svc.chatTurn = async () => {
    calls.push("turn");
    return { assistantMessage: "" };
  };
  svc.newOrderAlert = { alert: async () => calls.push("alert") };
  await svc.chat("o1", "Нужен манипулятор, Астана", "ru", {});
  check(calls.join(">") === "turn>alert", `порядок «${calls.join(">")}»: владелец узнаёт о заявке до того, как её разобрали`);

  // Вторая реплика — без оповещения
  calls.length = 0;
  svc.prisma = { chatMessage: { count: async () => 1 } };
  await svc.chat("o1", "завтра", "ru", {});
  check(!calls.includes("alert"), "владельца оповестили о заявке второй раз");
}

export default { name: "правки по переписке 30.08–13.09", checked, failures };
