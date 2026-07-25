import { IsIn, IsOptional, IsString } from "class-validator";

export type OrderCompletionOutcome = "resolved" | "redispatch" | "closed";
const OUTCOMES: OrderCompletionOutcome[] = ["resolved", "redispatch", "closed"];

export class CompleteOrderDto {
  @IsIn(OUTCOMES)
  outcome!: OrderCompletionOutcome;

  @IsOptional()
  @IsString()
  comment?: string;

  // Which notified supplier the client says they actually dealt with —
  // only meaningful for "resolved"/"closed" (see OrdersService.completeOrder).
  // Undefined/omitted when the client skips it or nothing was notified.
  @IsOptional()
  @IsString()
  servedBySupplierId?: string;
}
