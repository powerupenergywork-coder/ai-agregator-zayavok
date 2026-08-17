import { Injectable, Logger } from "@nestjs/common";
import OpenAI from "openai";
import { CategoryField } from "@ai-zayavki/shared";
import { env } from "../config/env";
import { AiCategoryOption, AiProvider, AiUnavailableError, ClassifyResult, IntentResult } from "./ai.types";

// Real provider — talks to OpenAI with a short timeout so a slow/unavailable
// API degrades to AiUnavailableError instead of blowing past the ≤5s NFR;
// OrdersService catches that and falls back to manual category selection.
const REQUEST_TIMEOUT_MS = 8000;

@Injectable()
export class OpenAiProvider implements AiProvider {
  private readonly logger = new Logger(OpenAiProvider.name);
  private readonly client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: env.openaiApiKey, timeout: REQUEST_TIMEOUT_MS });
  }

  async classify(message: string, categories: AiCategoryOption[]): Promise<ClassifyResult | null> {
    const catalog = categories
      .map((c) => `- ${c.slug}: ${c.name} (примеры: ${c.examples.join("; ")})`)
      .join("\n");

    const system =
      "Ты классифицируешь запрос клиента службы заказа транспорта/услуг в одну из категорий. " +
      "Отвечай строго JSON без пояснений.";
    const user =
      `Категории:\n${catalog}\n\n` +
      `Сообщение клиента: "${message}"\n\n` +
      `Верни JSON вида {"slug": "<slug категории или null>", "confidence": <0..1>}.`;

    try {
      const completion = await this.client.chat.completions.create({
        model: env.openaiModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      const raw = completion.choices[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw) as { slug?: string | null; confidence?: number };
      if (!parsed.slug || !categories.some((c) => c.slug === parsed.slug)) return null;
      return { slug: parsed.slug, confidence: parsed.confidence ?? 0.7 };
    } catch (err) {
      this.logger.error(`classify() failed: ${(err as Error).message}`);
      throw new AiUnavailableError(err);
    }
  }

  async extractFields(
    message: string,
    fields: CategoryField[],
    knownFields: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    // Every field, including the ones already filled. Hiding them meant a
    // client correcting the review card ("не в 9 утра, а в 12:00") was
    // matched against an empty field list — so nothing could ever change
    // once the card was complete, which is precisely when people correct it.
    const fieldsDoc = fields
      .filter((f) => f.type !== "photo")
      .map((f) => {
        const opts = f.options ? ` варианты: ${f.options.map((o) => `${o.value}=${o.label.ru}`).join(", ")}` : "";
        const unit = f.unit ? ` единица: ${f.unit}` : "";
        const unknownHint = f.allowUnknown
          ? " [клиент может не знать точное значение — см. правило про unknown/approximate/needs_consultation ниже]"
          : "";
        const current = knownFields[f.key] !== undefined ? ` ТЕКУЩЕЕ ЗНАЧЕНИЕ: ${String(knownFields[f.key])}.` : "";
        return `- ${f.key} (${f.type}${unit}): ${f.label.ru}.${current}${opts}${unknownHint}`;
      })
      .join("\n");

    if (!fieldsDoc) return {};

    const system =
      "Извлекай из сообщения клиента значения перечисленных полей заявки. " +
      "Заполняй только те поля, для которых в тексте есть явное значение. " +
      "У части полей уже есть ТЕКУЩЕЕ ЗНАЧЕНИЕ — это заполненные ранее данные. " +
      "Включай такое поле в ответ, только если клиент явно называет для него новое значение " +
      "или просит его изменить (например «не в 9 утра, а в 12:00» — верни новое время). " +
      "Если про поле в сообщении ничего нет, не включай его в ответ вообще. " +
      "Даты возвращай в формате YYYY-MM-DD (сегодня, завтра, послезавтра считай от текущей даты). " +
      "Для полей, помеченных как допускающие незнание точного значения, возвращай РОВНО один из трёх служебных токенов " +
      "латиницей, а не фразу клиента: если клиент прямо говорит, что не знает — верни строку \"unknown\"; " +
      "если он даёт грубую прикидку не в требуемых единицах (например, сравнивает с объёмом машины вместо числа в м³) — верни строку \"approximate\"; " +
      "если он просит совета или оценки исполнителя — верни строку \"needs_consultation\". " +
      "Не оставляй такое поле пустым, если клиент вообще что-то ответил по существу этого вопроса. " +
      "Отвечай строго JSON без пояснений — объект {ключ: значение}, без лишних ключей.";
    const user = `Сегодняшняя дата: ${new Date().toISOString().slice(0, 10)}\n\nПоля:\n${fieldsDoc}\n\nСообщение клиента: "${message}"`;

    try {
      const completion = await this.client.chat.completions.create({
        model: env.openaiModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      const raw = completion.choices[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch (err) {
      this.logger.error(`extractFields() failed: ${(err as Error).message}`);
      throw new AiUnavailableError(err);
    }
  }

  /**
   * Последняя попытка понять сообщение перед отпиской.
   *
   * Возвращает null, а не бросает: этот вызов стоит на пути, где мы и так
   * собирались сказать «не могу понять». Упасть здесь значит превратить
   * неудачную догадку в ошибку разговора, хотя терять нечего.
   */
  async classifyIntent(message: string, categories: AiCategoryOption[]): Promise<IntentResult | null> {
    const catalog = categories.map((c) => `- ${c.slug}: ${c.name}`).join("\n");
    const system =
      "Ты определяешь НАМЕРЕНИЕ сообщения в WhatsApp-сервисе заказа техники и услуг в Казахстане. " +
      "Сервис соединяет заказчиков с исполнителями: заказчик описывает задачу, исполнители звонят ему напрямую.\n\n" +
      "Возможные намерения:\n" +
      "client_request — человек хочет заказать услугу для себя;\n" +
      "supplier_offer — человек предлагает СВОИ услуги или технику, хочет получать заявки;\n" +
      "question_about_service — спрашивает, кто мы, что за сервис, откуда у нас его номер;\n" +
      "price_question — спрашивает, сколько это стоит;\n" +
      "cancel_request — просит отменить заявку или больше не писать;\n" +
      "agreement — соглашается с последним предложением («можно», «давайте», «хорошо»);\n" +
      "autoreply — это автоответчик другой компании, а не живой человек;\n" +
      "unknown — непонятно.\n\n" +
      "Отличай client_request от supplier_offer по тому, КОМУ нужна услуга. " +
      "«Нужна газель» — заказчик. «У нас газель, звоните» — исполнитель. " +
      "Текст может быть с опечатками и без пробелов — это нормально.\n\n" +
      // Два таких сообщения модель принимала за заявку клиента: перечень
      // услуг без единой просьбы выглядит как заказ, если не знать, что это
      // приветствие чужого бота. Признаки перечислены прямо.
      "autoreply распознаётся по форме, а не по теме: «Спасибо за обращение», " +
      "«Ваше сообщение принято», «Чем мы можем вам помочь», перечень своих услуг " +
      "без единой просьбы и без конкретной задачи, приветствие компании в ответ на " +
      "наше сообщение. Если человек ничего не просит и ни о чём не спрашивает, а " +
      "просто перечисляет услуги в шаблонной вежливой форме — это autoreply, а не заказ.\n\n" +
      "Отвечай строго JSON без пояснений.";
    const user =
      `Категории сервиса:\n${catalog}\n\n` +
      `Сообщение: "${message}"\n\n` +
      'Верни {"intent": "<одно из перечисленных>", "confidence": <0..1>, ' +
      '"citySuggestion": "<город, если назван, иначе не включай>", ' +
      '"categorySlugs": ["<slug>", ...] — категории, о которых речь; пустой массив, если неясно}.';

    try {
      const completion = await this.client.chat.completions.create({
        model: env.openaiModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Partial<IntentResult>;
      if (!parsed.intent) return null;
      // Категории, которых у нас нет, модель иногда придумывает — оставляем
      // только настоящие, иначе подставим человеку несуществующую услугу.
      const known = new Set(categories.map((c) => c.slug));
      return {
        intent: parsed.intent,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        citySuggestion: parsed.citySuggestion || undefined,
        categorySlugs: (parsed.categorySlugs ?? []).filter((s) => known.has(s)),
      };
    } catch (err) {
      this.logger.warn(`classifyIntent() failed: ${(err as Error).message}`);
      return null;
    }
  }
}
