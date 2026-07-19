// Mirrors apps/api/src/orders/dto/cancel-order.dto.ts — keep values in sync.
// Labels are bilingual — see lib/i18n/dictionaries/{ru,kk}.ts's `reasons` key,
// keyed by the same `value` strings as this list.

export const CANCEL_REASON_VALUES = [
  "not_needed_anymore",
  "plans_changed",
  "arranged_directly",
  "offers_not_suitable",
  "order_mistake",
  "other",
] as const;
