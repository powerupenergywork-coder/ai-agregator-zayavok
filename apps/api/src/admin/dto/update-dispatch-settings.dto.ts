import { IsInt, IsOptional, Min } from "class-validator";

export class UpdateDispatchSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  waveSize?: number;
}
