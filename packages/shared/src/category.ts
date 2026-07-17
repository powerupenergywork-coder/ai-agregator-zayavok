// Category template schema — drives both the AI extraction prompt and the
// dynamic quick-reply UI. Admins edit these without a deploy (see admin module).

export type CategoryFieldType =
  | "text"
  | "number"
  | "enum"
  | "date"
  | "time"
  | "address"
  | "photo"
  | "boolean";

export interface CategoryFieldOption {
  value: string;
  label: string;
}

export interface CategoryField {
  key: string;
  label: string;
  type: CategoryFieldType;
  required: boolean;
  /** Shown as tap-able chips instead of free text when present. */
  options?: CategoryFieldOption[];
  /** Unit suffix for numeric fields, e.g. "т", "м³". */
  unit?: string;
  /**
   * Fields the client genuinely may not know (weight, volume, dimensions) can be
   * answered with "не знаю" / "примерно" / "нужна консультация" per ТЗ п.4.4
   * instead of blocking the order.
   */
  allowUnknown?: boolean;
  /** The clarifying question the AI asks when this field is missing. */
  question: string;
  /**
   * Fields sharing the same combineGroup are asked together in a single
   * message when both are missing (e.g. "адрес загрузки и адрес выгрузки"),
   * per ТЗ п.4.2 — max ~2 questions per turn, batch related ones.
   */
  combineGroup?: string;
}

export interface CategoryTemplate {
  slug: string;
  name: string;
  icon?: string;
  /** Example phrases shown as chips on the landing page. */
  examples: string[];
  fields: CategoryField[];
}

export const UNKNOWN_VALUE_OPTIONS: CategoryFieldOption[] = [
  { value: "unknown", label: "Не знаю" },
  { value: "approximate", label: "Примерно" },
  { value: "needs_consultation", label: "Нужна консультация исполнителя" },
];
