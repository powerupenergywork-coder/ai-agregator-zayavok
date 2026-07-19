import { IsInt, IsOptional, Matches, Min } from "class-validator";

export class UpdateDispatchSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  waveSize?: number;

  // Global default quiet-hours window (see matching/quiet-hours.util.ts) —
  // fallback used by suppliers who haven't set their own workingHoursStart/End.
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  quietHoursStart?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  quietHoursEnd?: string;
}
