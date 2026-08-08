// Small typed accessor over process.env so every module reads config the same
// way, with the same defaults, instead of scattering `process.env.X || "y"`.

function str(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${key}`);
}

function num(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? Number(v) : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return v === "true" || v === "1";
}

/** Список через запятую. Пустая строка — это осознанно пустой список, а не
 * «взять умолчание»: иначе нельзя было бы отключить перечисление вовсе. */
function list(key: string, fallback: string[]): string[] {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

export const env = {
  nodeEnv: str("NODE_ENV", "development"),
  apiPort: num("API_PORT", 3001),
  apiUrl: str("API_URL", "http://localhost:3001"),
  webUrl: str("WEB_URL", "http://localhost:3000"),
  jwtSecret: str("JWT_SECRET", "dev-secret-change-me"),

  databaseUrl: str("DATABASE_URL", "postgresql://app:app@localhost:5432/ai_zayavki"),
  redisUrl: str("REDIS_URL", "redis://localhost:6379"),

  trustedDeviceDays: num("TRUSTED_DEVICE_DAYS", 3),
  otpCodeTtlSeconds: num("OTP_CODE_TTL_SECONDS", 300),
  otpResendCooldownSeconds: num("OTP_RESEND_COOLDOWN_SECONDS", 60),
  otpMaxAttempts: num("OTP_MAX_ATTEMPTS", 5),

  smsProvider: str("SMS_PROVIDER", "console"),
  mobizonApiKey: str("MOBIZON_API_KEY", ""),
  // .kz and .com are separate installations with separate accounts — a key
  // issued on one returns "invalid" on the other, which reads like a bad key.
  mobizonApiHost: str("MOBIZON_API_HOST", "api.mobizon.kz"),
  // Alphanumeric sender name, if one has been approved. Left empty, Mobizon
  // uses the account default.
  mobizonSenderName: str("MOBIZON_SENDER_NAME", ""),

  aiProvider: str("AI_PROVIDER", "mock"),
  openaiApiKey: str("OPENAI_API_KEY", ""),
  openaiModel: str("OPENAI_MODEL", "gpt-4.1-mini"),

  storageProvider: str("STORAGE_PROVIDER", "local"),
  s3Endpoint: str("S3_ENDPOINT", "http://localhost:9000"),
  s3Region: str("S3_REGION", "us-east-1"),
  s3Bucket: str("S3_BUCKET", "order-photos"),
  s3AccessKey: str("S3_ACCESS_KEY", "minioadmin"),
  s3SecretKey: str("S3_SECRET_KEY", "minioadmin"),
  s3ForcePathStyle: bool("S3_FORCE_PATH_STYLE", true),

  mapsProvider: str("MAPS_PROVIDER", "none"),
  twoGisApiKey: str("TWOGIS_API_KEY", ""),

  // ТОЛЬКО начальное значение: при первом запуске из него создаётся строка
  // DispatchSettings, дальше размер волны живёт в базе и правится из админки.
  // Менять здесь у работающего сервиса бесполезно — легко принять за
  // действующую настройку и потом искать, почему она ни на что не влияет.
  dispatchWaveSize: num("DISPATCH_WAVE_SIZE", 30),
  // Global default quiet-hours window for suppliers who haven't set their own
  // (DispatchSettings.quietHoursStart/End takes priority when set — this is
  // just the fallback). See matching/quiet-hours.util.ts.
  dispatchQuietHoursStart: str("DISPATCH_QUIET_HOURS_START", "08:00"),
  dispatchQuietHoursEnd: str("DISPATCH_QUIET_HOURS_END", "21:00"),
  dispatchTimezone: str("DISPATCH_TIMEZONE", "Asia/Almaty"),

  // Через сколько минут простоя напомнить о недооформленной заявке. Час —
  // человек успел отвлечься, но ещё помнит, о чём шла речь. 0 отключает
  // напоминания совсем. Напоминание всегда ровно одно: см.
  // OrdersService.nudgeAbandonedDrafts().
  draftNudgeAfterMinutes: num("DRAFT_NUDGE_AFTER_MINUTES", 60),

  // Since suppliers now contact the client directly (no in-system offer
  // selection), the system has to proactively ask whether the order got
  // resolved instead of waiting for the client to come back and close it.
  // The platform is a pure connector with no delivery guarantee — a client
  // who never answers the check-in gets auto-closed, not escalated to a
  // human operator (see OrdersService.autoCloseStaleOrder).
  orderCheckinDelayHours: num("ORDER_CHECKIN_DELAY_HOURS", 24),
  orderCheckinAutoCloseHours: num("ORDER_CHECKIN_AUTO_CLOSE_HOURS", 1),

  whatsappProvider: str("WHATSAPP_PROVIDER", "console"),
  greenApiBaseUrl: str("GREEN_API_BASE_URL", "https://api.green-api.com"),
  greenApiIdInstance: str("GREEN_API_ID_INSTANCE", ""),
  greenApiTokenInstance: str("GREEN_API_TOKEN_INSTANCE", ""),
  whatsappWebhookToken: str("WHATSAPP_WEBHOOK_TOKEN", "dev-webhook-token-change-me"),

  // Meta WhatsApp Cloud API (WABA) — separate from GREEN-API above; selected
  // via WHATSAPP_PROVIDER=cloud-api. Webhook verification uses its own query-param
  // handshake (hub.verify_token), distinct from WHATSAPP_WEBHOOK_TOKEN's Authorization header.
  whatsappCloudApiVersion: str("WHATSAPP_CLOUD_API_VERSION", "v21.0"),
  whatsappCloudPhoneNumberId: str("WHATSAPP_CLOUD_PHONE_NUMBER_ID", ""),
  whatsappCloudAccessToken: str("WHATSAPP_CLOUD_ACCESS_TOKEN", ""),
  whatsappCloudWebhookVerifyToken: str("WHATSAPP_CLOUD_WEBHOOK_VERIFY_TOKEN", "dev-verify-token-change-me"),
  // Идентификатор WABA. Нужен, чтобы вытащить у Меты тексты утверждённых
  // шаблонов и показывать в стенограмме то, что человек реально увидел, а не
  // список подстановок. Пусто = стенограмма покажет подстановки, как раньше.
  whatsappCloudWabaId: str("WHATSAPP_CLOUD_WABA_ID", ""),
  // TEST-ONLY: works around one broken Meta sandbox test-recipient entry —
  // see the comment in cloud-api.provider.ts. Leave both blank in production.
  whatsappCloudSandboxPhone: str("WHATSAPP_CLOUD_SANDBOX_PHONE", ""),
  whatsappCloudSandboxTo: str("WHATSAPP_CLOUD_SANDBOX_TO", ""),

  // PROSPECT-онбординг (прогрев поставщиков) — см. ТЗ_прогрев_поставщиков_v2.
  prospectIgnoreTimeoutDays: num("PROSPECT_IGNORE_TIMEOUT_DAYS", 14),
  prospectResendCooldownDays: num("PROSPECT_RESEND_COOLDOWN_DAYS", 7),

  // Сколько раз и как часто можно позвать человека, который нам ничего не
  // отвечал. Приглашение едет вместе с заявкой, а список «кому уже слали»
  // ведётся по каждой заявке отдельно — без этих двух ограничений десять
  // заявок в день на автокран в Астане означали бы десять приглашений в день
  // одному и тому же человеку. Он не нажмёт «не писать мне», он пожалуется
  // на спам, а жалобы бьют по рейтингу качества номера.
  //
  // Три попытки — та же лестница, что в replyToSupplier(): на третий раз
  // молчим. Молчание собеседника тоже ответ.
  supplierInviteCooldownDays: num("SUPPLIER_INVITE_COOLDOWN_DAYS", 3),
  supplierInviteMaxAttempts: num("SUPPLIER_INVITE_MAX_ATTEMPTS", 3),

  paymentProvider: str("PAYMENT_PROVIDER", "mock"),
  // Куда звать поставщика, пока принимать деньги нечем: см. paymentsEnabled().
  supportPhone: str("SUPPORT_PHONE", "+7 778 709 8251"),
  // Номер бота в WhatsApp — на него ведёт кнопка «Начать в WhatsApp» со
  // страницы для исполнителей. Только цифры: из них собирается ссылка wa.me.
  whatsappBotPhone: str("WHATSAPP_BOT_PHONE", "77089526570"),
  // Ниже этого числа блок «заявок за неделю» на публичной странице не
  // показывается: маленькая цифра убеждает исполнителя, что работы нет.
  publicStatsMinOrders: num("PUBLIC_STATS_MIN_ORDERS", 10),
  // Приём платежей по протоколу биллера Kaspi: не мы создаём платёж, а Kaspi
  // дёргает наш GET /kaspi/pay запросами check и pay. Пока false — endpoint
  // отвечает «ошибка провайдера» на всё, чтобы недонастроенная интеграция не
  // раздавала подписки.
  kaspiBillerEnabled: bool("KASPI_BILLER_ENABLED", false),
  // Единственная защита, которую даёт протокол: никакой подписи в нём нет.
  // Адреса из «Протокола взаимодействия (онлайн)». Третий в документе указан
  // как 197.187.244.108 — почти наверняка опечатка (194), поэтому держим оба
  // до подтверждения от банка.
  kaspiAllowedIps: list("KASPI_ALLOWED_IPS", [
    "194.187.247.152",
    "194.187.245.108",
    "197.187.244.108",
    "194.187.244.108",
  ]),
  // Необязательный общий секрет: если банк согласится передавать постоянное
  // значение в data1, проверим и его. Защита сверх IP, а не вместо — пустая
  // строка отключает проверку.
  kaspiSharedSecret: str("KASPI_SHARED_SECRET", ""),
  // Как услуга называется в списке платежей Kaspi. Поставщик ищет её по
  // этому названию, поэтому в инструкции должно стоять ровно оно.
  kaspiServiceName: str("KASPI_SERVICE_NAME", "KerekTap"),
  // Сколько дней счёт принимается к оплате. Без срока однажды придёт платёж
  // по счёту годичной давности с давно неактуальной ценой.
  invoiceValidDays: num("INVOICE_VALID_DAYS", 30),
  // Ссылка, открывающая оплату сразу в приложении Kaspi. Подстановки:
  // {invoice} — номер счёта, {sum} — сумма в тенге.
  //
  // Kaspi именует параметры числовыми идентификаторами полей услуги, которые
  // назначает при регистрации, поэтому вид примерно такой:
  //   https://kaspi.kz/pay/KerekTap?service_id=00000&15988={invoice}&15989={sum}
  // Сами номера полей приходят от банка вместе с готовой ссылкой.
  //
  // Пустая по умолчанию намеренно: выдуманная ссылка — это человек, который
  // ткнул и не смог заплатить, причём мы об этом даже не узнаем.
  kaspiPayUrlTemplate: str("KASPI_PAY_URL_TEMPLATE", ""),
  // Формат ответа по умолчанию: xml или json. Протокол разрешает оба и ведёт
  // с XML; какой читает их парсер, выясняется на тестах, поэтому это
  // настройка, а не константа. Запрос может переопределить: ?format=xml или
  // заголовок Accept.
  kaspiResponseFormat: str("KASPI_RESPONSE_FORMAT", "json"),
  // На сколько записей отступить от КОНЦА X-Forwarded-For, чтобы получить
  // настоящий адрес клиента. Ноль — то есть последняя запись — потому что
  // сегодня своих прокси в заголовке не видно; проверено опытом на боевом
  // сервере, см. комментарий в kaspi-biller.controller.ts::clientIp().
  // Отсчёт именно от конца: левые записи подделываются клиентом целиком.
  trustedProxyHops: num("TRUSTED_PROXY_HOPS", 0),
  // Цена подписки. Попадает в выставленный счёт и в сообщение поставщику,
  // поэтому меняется только вместе с уже открытыми счетами: в них сумма
  // зафиксирована на момент выставления и новой ценой не переписывается.
  //
  // 5000 — временное значение на период интеграции с Kaspi, чтобы тестовые
  // счета, примеры в документе для банка и ответы сервиса не расходились
  // между собой. При запуске приёма оплат ставится 10000.
  subscriptionPriceTenge: num("SUBSCRIPTION_PRICE_TENGE", 5000),
  subscriptionPeriodDays: num("SUBSCRIPTION_PERIOD_DAYS", 30),
  // За сколько дней до конца подписки выставить счёт и предупредить. Не в
  // день окончания: поставщик должен успеть заплатить, не потеряв ни дня
  // рассылки, а деньги в Kaspi доходят не мгновенно.
  subscriptionExpiryNoticeDays: num("SUBSCRIPTION_EXPIRY_NOTICE_DAYS", 3),
  freeNotificationsPerMonth: num("FREE_NOTIFICATIONS_PER_MONTH", 10),

  // Сколько дней держать стенограмму переписки в WhatsApp. Это персональные
  // данные, и разбор «где человек застрял» идёт по горячим следам, а не через
  // полгода. 0 = хранить бессрочно (осознанный выключатель, не значение по
  // умолчанию). См. whatsapp/transcript-retention.service.ts.
  whatsappTranscriptRetentionDays: num("WHATSAPP_TRANSCRIPT_RETENTION_DAYS", 7),
};

/**
 * Умеем ли мы вообще принять деньги.
 *
 * Два разных способа. Kaspi по протоколу биллера — деньги вносятся в самом
 * приложении банка, ссылки нет и быть не может, поэтому проверяется отдельным
 * флагом. Остальные провайдеры работают через createPayment() и ссылку;
 * PAYMENT_PROVIDER=mock выдаёт ссылку на наш же /billing/mock-confirm/:ref,
 * которая включает платную подписку бесплатно в один тап — отправить такую
 * поставщику значит раздать подписки даром.
 */
export function paymentsEnabled(): boolean {
  return env.kaspiBillerEnabled || env.paymentProvider !== "mock";
}

/** Оплата идёт внутри Kaspi: платёж создаёт банк, а не мы. */
export function kaspiBillerActive(): boolean {
  return env.kaspiBillerEnabled;
}

/**
 * Прямая ссылка на оплату счёта в Kaspi — или undefined, если формат ссылки
 * ещё не получен от банка.
 *
 * Ссылка не заменяет инструкцию, а дополняет её: она открывает приложение, а
 * платят и с компьютера, и с телефона без Kaspi, и по пересланному кому-то
 * номеру. Убрать текстовые шаги значило бы отрезать всех троих.
 */
export function kaspiPayUrl(invoiceNumber: string, sumTenge?: number): string | undefined {
  if (!env.kaspiPayUrlTemplate) return undefined;
  return env.kaspiPayUrlTemplate
    .replace("{invoice}", encodeURIComponent(invoiceNumber))
    .replace("{sum}", String(sumTenge ?? env.subscriptionPriceTenge));
}
