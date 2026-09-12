/**
 * Проверка связи с Tole в песочнице — до того, как включать на бою.
 *
 * Ничего из нашего кода не трогает и в базу не пишет: это разговор с их API
 * напрямую, чтобы отделить «не работает у нас» от «не работает у них».
 *
 *   TOLE_API_KEY=tole_sk_test_v1_… node ops/tole-smoke.mjs
 *
 * Что делает по шагам:
 *   1. создаёт подключение песочницы (если TOLE_CONNECTION_ID не задан);
 *   2. выставляет счёт на 100 ₸ синтетическому номеру;
 *   3. показывает, что вернулось, включая идентификатор операции.
 *
 * Живые счета этим скриптом не выставляются: все маршруты — /sandbox/*,
 * настоящий Kaspi при этом не вызывается.
 *
 * Если тестового ключа в кабинете нет, есть второй режим — только чтение:
 *
 *   TOLE_API_KEY=tole_sk_live_v1_… node ops/tole-smoke.mjs --read-only
 *
 * Он ходит боевым ключом, но исключительно методом GET: тариф, история
 * операций. Ни одного счёта при этом не появляется — POST в этом режиме
 * физически запрещён, а не «не вызывается по договорённости».
 */

const BASE = process.env.TOLE_BASE_URL ?? "https://api.tolepay.kz/v1";
const KEY = process.env.TOLE_API_KEY ?? "";
const PHONE = process.env.TOLE_TEST_PHONE ?? "+77001234567";

const READ_ONLY = process.argv.includes("--read-only");

if (!KEY) {
  console.error("Нет TOLE_API_KEY. Нужен ключ из кабинета Tole.");
  process.exit(1);
}
if (!KEY.includes("test") && !READ_ONLY) {
  console.error("Это боевой ключ. Полный смоук запускается только тестовым — иначе счёт уйдёт живому человеку.");
  console.error("Проверить связь боевым ключом можно так: node ops/tole-smoke.mjs --read-only");
  process.exit(1);
}

let connectionId = process.env.TOLE_CONNECTION_ID ?? "";

async function call(method, path, { body, idempotencyKey } = {}) {
  // Запрет, а не договорённость: в режиме чтения любой изменяющий запрос —
  // это ошибка скрипта, и лучше упасть здесь, чем выставить счёт живому
  // человеку, который его не ждёт.
  if (READ_ONLY && method !== "GET") {
    throw new Error(`Режим только для чтения: ${method} ${path} запрещён`);
  }
  const headers = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
  if (connectionId) headers["X-Tole-Connection-Id"] = connectionId;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  console.log(`${method} ${path} → ${res.status}`);
  console.log(JSON.stringify(json, null, 2).slice(0, 1200));
  console.log("");
  return { status: res.status, json };
}

if (READ_ONLY) {
  console.log("Режим только для чтения: счета не выставляются.\n");
  // Тариф — первое, обо что спотыкается интеграция: без активной подписки
  // Tole отвечает 402 на первом же счёте.
  await call("GET", "/billing/overview");
  // История операций подтверждает, что ключ, подключение и их сторона
  // сходятся: пустой список — нормальный ответ, важен код 200.
  await call("GET", "/invoices/history?limit=5");
  console.log("Если оба ответа 200 — ключ, подключение и связь в порядке.");
  console.log("403 — не хватает прав ключу; 401 — ключ; 402 — тариф не оплачен.");
  process.exit(0);
}

if (!connectionId) {
  const conn = await call("POST", "/sandbox/connections", { body: { displayName: "KerekTap smoke" } });
  connectionId = conn.json?.data?.id ?? conn.json?.id ?? "";
  if (!connectionId) {
    console.error("Подключение песочницы не создалось — дальше смысла нет.");
    process.exit(1);
  }
  console.log(`Подключение: ${connectionId}`);
  console.log("Его же положить в TOLE_CONNECTION_ID, чтобы следующий запуск не плодил новые.\n");
}

// Есть ли у номера Kaspi. В песочнице ответ синтетический, но путь тот же.
await call("POST", "/sandbox/invoices/client-info", { body: { phoneNumber: PHONE } });

// Тот же ключ идемпотентности, что и в бою: производный от номера счёта.
const invoice = await call("POST", "/sandbox/invoices", {
  idempotencyKey: `kerektap-smoke-${new Date().toISOString().slice(0, 10)}`,
  body: { phoneNumber: PHONE, amount: 100, comment: "KerekTap: проверка связи" },
});

const operationId = invoice.json?.data?.id;
if (operationId) {
  console.log(`Счёт создан: ${operationId}`);
  console.log("Оплату в песочнице имитирует POST /sandbox/payment-intents/<id>/simulate с {\"status\":\"paid\"}.");
  console.log("После него должен прийти вебхук на https://kerektap.kz/api/tole/webhook — смотрите логи API.");
} else {
  console.log("Счёт не создан. Смотрите код и message выше: 401 — ключ, 402 — тариф, 403 — права ключа.");
}
