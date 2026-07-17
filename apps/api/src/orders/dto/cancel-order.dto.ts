import { IsIn, IsOptional, IsString } from "class-validator";

export const CANCEL_REASONS = [
  "not_needed_anymore",
  "plans_changed",
  "arranged_directly",
  "offers_not_suitable",
  "order_mistake",
  "other",
] as const;

export class CancelOrderDto {
  @IsIn(CANCEL_REASONS)
  reason!: (typeof CANCEL_REASONS)[number];

  @IsOptional()
  @IsString()
  comment?: string;
}
