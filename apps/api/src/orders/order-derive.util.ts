import { CategoryField } from "@ai-zayavki/shared";

/**
 * Category templates store everything in one flexible fieldsData JSON blob,
 * but matching (task 7) needs plain city/address columns to query suppliers
 * by service area. This pulls the first one or two "address" fields into
 * Order.addressFrom/addressTo, the dedicated "city" field into Order.city,
 * and the first date/time fields into Order.dateNeeded/timeWindow, purely so
 * those queries stay simple SQL.
 *
 * Every category template now asks for city as its own field (key: "city"),
 * separate from the free-text address — matching against a supplier's
 * ServiceArea.city needs an exact city name, not a full street address, and
 * MAPS_PROVIDER=none (see .env.example) means there's no real geocoding to
 * pull one out of address text reliably. Falls back to the first address
 * field for any category that predates this (shouldn't normally happen,
 * every seeded category has "city" now, but better than silently matching
 * nothing).
 */
export function deriveDenormalizedColumns(
  fields: CategoryField[],
  data: Record<string, unknown>,
): {
  addressFrom?: string;
  addressTo?: string;
  city?: string;
  dateNeeded?: Date;
  timeWindow?: string;
} {
  const addressFields = fields.filter((f) => f.type === "address");
  const cityField = fields.find((f) => f.key === "city");
  const dateField = fields.find((f) => f.type === "date");
  const timeField = fields.find((f) => f.type === "time");

  const first = addressFields[0];
  const second = addressFields[1];
  const firstVal = first && typeof data[first.key] === "string" ? (data[first.key] as string) : undefined;
  const secondVal = second && typeof data[second.key] === "string" ? (data[second.key] as string) : undefined;
  const cityVal =
    cityField && typeof data[cityField.key] === "string" ? (data[cityField.key] as string).trim() : undefined;

  const dateVal = dateField && typeof data[dateField.key] === "string" ? (data[dateField.key] as string) : undefined;
  const timeVal = timeField && typeof data[timeField.key] === "string" ? (data[timeField.key] as string) : undefined;

  return {
    addressFrom: firstVal,
    addressTo: secondVal,
    city: cityVal ?? firstVal,
    dateNeeded: dateVal ? new Date(dateVal) : undefined,
    timeWindow: timeVal,
  };
}

/** Joins the question text of the field(s) picked by nextQuestionFields into one assistant message. */
export function buildQuestionText(fields: CategoryField[]): string {
  const unique = Array.from(new Set(fields.map((f) => f.question)));
  return unique.join(" ");
}

export const READY_FOR_REVIEW_MESSAGE =
  "Отлично! Все данные собраны. Проверьте карточку заявки ниже и отправьте её.";
