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

export interface AiProvider {
  classify(message: string, categories: AiCategoryOption[]): Promise<ClassifyResult | null>;

  extractFields(
    message: string,
    fields: CategoryField[],
    knownFields: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
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
