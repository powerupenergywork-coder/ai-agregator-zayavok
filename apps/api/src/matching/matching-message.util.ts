import { CategoryField } from "@ai-zayavki/shared";
import { formatFieldValue } from "../common/field-format.util";

// The broadcast to suppliers carries everything — there's no click-through
// step left before contact, so suppliers need enough to decide right there.

interface OrderLike {
  urgent: boolean;
  dateNeeded: Date | null;
  timeWindow: string | null;
  fieldsData: unknown;
}

export function formatWhen(order: OrderLike): string {
  if (order.urgent) return "Срочно";
  if (!order.dateNeeded) return "Дата уточняется";
  const date = new Date(order.dateNeeded).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  return order.timeWindow ? `${date}, ${order.timeWindow}` : date;
}

export function fullDescription(fieldsData: unknown, categoryFields: CategoryField[]): string {
  const data = (fieldsData ?? {}) as Record<string, unknown>;
  return categoryFields
    .filter((f) => f.type !== "photo" && data[f.key] !== undefined)
    .map((f) => `${f.label}: ${formatFieldValue(data[f.key], f)}`)
    .join("\n");
}
