import { Injectable, Logger } from "@nestjs/common";
import OpenAI from "openai";
import { CategoryField } from "@ai-zayavki/shared";
import { env } from "../config/env";
import { AiCategoryOption, AiProvider, AiUnavailableError, ClassifyResult } from "./ai.types";

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
    const fieldsDoc = fields
      .filter((f) => knownFields[f.key] === undefined)
      .map((f) => {
        const opts = f.options ? ` варианты: ${f.options.map((o) => `${o.value}=${o.label.ru}`).join(", ")}` : "";
        const unit = f.unit ? ` единица: ${f.unit}` : "";
        return `- ${f.key} (${f.type}${unit}): ${f.label.ru}.${opts}`;
      })
      .join("\n");

    if (!fieldsDoc) return {};

    const system =
      "Извлекай из сообщения клиента значения перечисленных полей заявки. " +
      "Заполняй только те поля, для которых в тексте есть явное значение. " +
      "Даты возвращай в формате YYYY-MM-DD (сегодня, завтра, послезавтра считай от текущей даты). " +
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
}
