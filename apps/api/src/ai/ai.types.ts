import { CategoryField } from "@ai-zayavki/shared";

// AI is deliberately scoped to two narrow jobs, not "run the whole
// conversation": (1) classify free text into a category, (2) pull field
// values out of free text. Deciding *which question to ask next* is plain
// deterministic logic over the category template (see field-completion.util)
// — no AI call, no hallucination risk, same behavior on mock and real
// providers. This matches ТЗ's "AI задаёт уточняющие вопросы" while keeping
// the question wording admin-editable and predictable.

export interface AiCategoryOption {
  slug: string;
  name: string;
  examples: string[];
}

export interface ClassifyResult {
  slug: string;
  confidence: number;
}

/**
 * Что человек хотел сказать, когда ни одна регулярка не совпала.
 *
 * Третья работа для ИИ рядом с двумя выше, и намеренно узкая: не «веди
 * разговор», а «назови намерение». Дальше действует обычный код.
 *
 * Зачем: на проде 12 непонятых сообщений из 340 входящих, и половина —
 * исполнители, которые сами к нам пришли. «Здрастуйте унас газел и гручики
 * в,Астане», «Бопкат», «Бригада» — каждое такое требовало новой регулярки,
 * и так по одному живому случаю за раз.
 */
export type MessageIntent =
  | "client_request"
  | "supplier_offer"
  | "question_about_service"
  | "price_question"
  | "cancel_request"
  | "agreement"
  /** Автоответчик чужой фирмы. Отвечать нельзя: два бота переписываются вечно. */
  | "autoreply"
  | "unknown";

export interface IntentResult {
  intent: MessageIntent;
  confidence: number;
  /** Что удалось вытащить попутно. Для исполнителя — что он предлагает и
   *  откуда; для клиента — город. Ничего не заполняем молча: значения идут
   *  в предложение с кнопкой, решает человек. */
  citySuggestion?: string;
  categorySlugs?: string[];
}

/** Ниже этого — ведём себя как раньше. Ошибиться намерением хуже, чем
 *  честно сказать «не понял»: неверная ветка уводит человека не туда и
 *  выглядит как подмена его слов. */
export const INTENT_CONFIDENCE_THRESHOLD = 0.6;

/**
 * Отдельная, высокая планка для намерений, которые заводят заявку.
 *
 * Прогон промпта по реальным непонятым сообщениям показал ровно одну опасную
 * ошибку: два чужих автоответчика («Спасибо за обращение. Газель,
 * грузоперевозки, грузчики, переезд») модель приняла за заявку клиента с
 * уверенностью 0.8. Завести по ним черновик значит ответить боту, получить
 * ответ и вернуть петлю, которую мы уже чинили — 34 сообщения за два часа.
 *
 * Ответить текстом можно и на догадке: цена ошибки — одно лишнее сообщение.
 * Завести заявку — нельзя: цена ошибки бесконечна. Поэтому порог здесь выше
 * настоящих заявок («нужна газель завтра» уверенно даёт 0.95) и выше обеих
 * ошибок, что и отсекает их без единой регулярки.
 */
export const INTENT_ACTION_THRESHOLD = 0.85;

export interface AiProvider {
  classify(message: string, categories: AiCategoryOption[]): Promise<ClassifyResult | null>;

  extractFields(
    message: string,
    fields: CategoryField[],
    knownFields: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;

  /** Вызывается ТОЛЬКО там, где мы иначе ответили бы «не могу понять».
   *  Поэтому дорогой путь стоит 3.5% сообщений, а не всех. */
  classifyIntent(message: string, categories: AiCategoryOption[]): Promise<IntentResult | null>;
}

export const AI_PROVIDER = Symbol("AI_PROVIDER");
export const CLASSIFY_CONFIDENCE_THRESHOLD = 0.55;

export class AiUnavailableError extends Error {
  readonly sourceError?: unknown;

  constructor(cause?: unknown) {
    super("AI-модуль временно недоступен, выберите категорию вручную");
    this.name = "AiUnavailableError";
    this.sourceError = cause;
  }
}
