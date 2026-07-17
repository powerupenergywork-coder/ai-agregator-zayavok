import { IsBoolean, IsOptional, IsString } from "class-validator";

export class CreateDraftDto {
  @IsOptional()
  @IsString()
  categorySlug?: string;

  @IsOptional()
  @IsBoolean()
  urgent?: boolean;
}
