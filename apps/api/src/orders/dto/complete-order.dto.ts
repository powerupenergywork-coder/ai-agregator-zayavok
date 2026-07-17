import { IsBoolean, IsOptional, IsString } from "class-validator";

export class CompleteOrderDto {
  @IsBoolean()
  positive!: boolean;

  @IsOptional()
  @IsString()
  comment?: string;
}
