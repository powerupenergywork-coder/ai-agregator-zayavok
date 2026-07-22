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

  dispatchWaveSize: num("DISPATCH_WAVE_SIZE", 15),
  // Global default quiet-hours window for suppliers who haven't set their own
  // (DispatchSettings.quietHoursStart/End takes priority when set — this is
  // just the fallback). See matching/quiet-hours.util.ts.
  dispatchQuietHoursStart: str("DISPATCH_QUIET_HOURS_START", "08:00"),
  dispatchQuietHoursEnd: str("DISPATCH_QUIET_HOURS_END", "21:00"),
  dispatchTimezone: str("DISPATCH_TIMEZONE", "Asia/Almaty"),

  // Since suppliers now contact the client directly (no in-system offer
  // selection), the system has to proactively ask whether the order got
  // resolved instead of waiting for the client to come back and close it.
  orderCheckinDelayHours: num("ORDER_CHECKIN_DELAY_HOURS", 24),
  orderCheckinEscalateHours: num("ORDER_CHECKIN_ESCALATE_HOURS", 48),

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
  // TEST-ONLY: works around one broken Meta sandbox test-recipient entry —
  // see the comment in cloud-api.provider.ts. Leave both blank in production.
  whatsappCloudSandboxPhone: str("WHATSAPP_CLOUD_SANDBOX_PHONE", ""),
  whatsappCloudSandboxTo: str("WHATSAPP_CLOUD_SANDBOX_TO", ""),

  // PROSPECT-онбординг (прогрев поставщиков) — см. ТЗ_прогрев_поставщиков_v2.
  prospectIgnoreTimeoutDays: num("PROSPECT_IGNORE_TIMEOUT_DAYS", 14),
  prospectResendCooldownDays: num("PROSPECT_RESEND_COOLDOWN_DAYS", 7),

  paymentProvider: str("PAYMENT_PROVIDER", "mock"),
  kaspiMerchantId: str("KASPI_MERCHANT_ID", ""),
  kaspiApiKey: str("KASPI_API_KEY", ""),
  // Placeholder price — not a real business decision, just what the mock flow
  // charges so the quota/subscription logic has something to test against.
  subscriptionPriceTenge: num("SUBSCRIPTION_PRICE_TENGE", 5000),
  subscriptionPeriodDays: num("SUBSCRIPTION_PERIOD_DAYS", 30),
  freeNotificationsPerMonth: num("FREE_NOTIFICATIONS_PER_MONTH", 10),
};
