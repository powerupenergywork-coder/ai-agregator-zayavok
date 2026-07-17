// Order status enum — lead-broadcast model: the system finds and notifies
// matching suppliers with the client's contact, suppliers call the client
// directly and arrange everything themselves. No offer collection/comparison,
// no per-supplier selection — the client just closes the order when done.
// Keeping this in @ai-zayavki/shared so the API's state machine and the
// web UI's status labels can never drift apart.

export const ORDER_STATUSES = [
  "DRAFT",
  "CLARIFYING",
  "AWAITING_PHONE_CONFIRMATION",
  "PUBLISHED",
  "NEEDS_OPERATOR",
  "COMPLETED",
  "CANCELLED_BY_CLIENT",
  "CANCELLED_BY_ADMIN",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS_RU: Record<OrderStatus, string> = {
  DRAFT: "Черновик",
  CLARIFYING: "Уточнение данных",
  AWAITING_PHONE_CONFIRMATION: "Ожидает подтверждения телефона",
  PUBLISHED: "Разослана поставщикам",
  NEEDS_OPERATOR: "Требуется вмешательство оператора",
  COMPLETED: "Завершена",
  CANCELLED_BY_CLIENT: "Отменена клиентом",
  CANCELLED_BY_ADMIN: "Отменена администратором",
};

// Allowed transitions — the API rejects any transition not listed here.
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ["CLARIFYING", "CANCELLED_BY_CLIENT"],
  CLARIFYING: ["AWAITING_PHONE_CONFIRMATION", "CANCELLED_BY_CLIENT"],
  AWAITING_PHONE_CONFIRMATION: ["PUBLISHED", "CANCELLED_BY_CLIENT"],
  PUBLISHED: ["COMPLETED", "NEEDS_OPERATOR", "CANCELLED_BY_CLIENT", "CANCELLED_BY_ADMIN"],
  NEEDS_OPERATOR: ["PUBLISHED", "CANCELLED_BY_CLIENT", "CANCELLED_BY_ADMIN"],
  COMPLETED: [],
  CANCELLED_BY_CLIENT: [],
  CANCELLED_BY_ADMIN: [],
};
