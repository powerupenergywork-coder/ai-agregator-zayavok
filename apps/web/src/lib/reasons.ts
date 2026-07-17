// Mirrors apps/api/src/orders/dto/cancel-order.dto.ts — keep values in sync.

export const CANCEL_REASON_OPTIONS = [
  { value: "not_needed_anymore", label: "Исполнитель больше не нужен" },
  { value: "plans_changed", label: "Изменились планы" },
  { value: "arranged_directly", label: "Договорился самостоятельно" },
  { value: "offers_not_suitable", label: "Не дозвонились до исполнителей" },
  { value: "order_mistake", label: "Ошибка в заявке" },
  { value: "other", label: "Другая причина" },
];
