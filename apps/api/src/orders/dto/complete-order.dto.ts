import { IsIn, IsOptional, IsString } from "class-validator";

/**
 * Чем закончилась заявка.
 *
 * Три исхода вместо прежних трёх действий — разница принципиальная. Раньше
 * кнопка «Закрыть заявку» означала в коде «услугу НЕ оказали»: клиенту
 * ставилась отрицательная оценка, заявка отменялась, исполнителям уходило
 * извинение. Человек читал надпись как «у меня всё, спасибо» и нажимал её
 * после успеха.
 *
 * Из-за этого заявки №108 и №113 записаны как провал, хотя исполнитель по ним
 * нашёлся: собственная статистика занижала результат вчетверо.
 *
 * Разница между found_via_us и found_elsewhere — единственная атрибуция,
 * которая у нас есть, и достаётся она тем же нажатием, а не отдельным
 * вопросом: спрашивать клиента дважды нельзя.
 */
export type OrderCompletionOutcome =
  | "found_via_us"
  | "found_elsewhere"
  // Клиент сказал словами «уже нашёл» — исход известен, атрибуция нет.
  // Записывать такое как found_elsewhere нельзя: это утверждение, что нашли
  // НЕ через нас, и именно так статистика занижалась вчетверо.
  | "found_unknown"
  | "not_needed"
  // Старые значения из кнопок, уже отправленных людям: сообщения в WhatsApp
  // живут вечно, и нажатие годичной давности обязано срабатывать.
  | "resolved"
  | "redispatch"
  | "closed";

const OUTCOMES: OrderCompletionOutcome[] = [
  "found_via_us",
  "found_elsewhere",
  "found_unknown",
  "not_needed",
  "resolved",
  "redispatch",
  "closed",
];

export class CompleteOrderDto {
  @IsIn(OUTCOMES)
  outcome!: OrderCompletionOutcome;

  @IsOptional()
  @IsString()
  comment?: string;
}
