import { IsIn, IsOptional, IsString } from "class-validator";

export type OrderCompletionOutcome = "resolved" | "redispatch" | "closed";
const OUTCOMES: OrderCompletionOutcome[] = ["resolved", "redispatch", "closed"];

export class CompleteOrderDto {
  @IsIn(OUTCOMES)
  outcome!: OrderCompletionOutcome;

  @IsOptional()
  @IsString()
  comment?: string;
}
