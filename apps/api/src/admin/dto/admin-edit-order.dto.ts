import { IsObject, IsOptional, IsString } from "class-validator";

export class AdminEditOrderDto {
  @IsOptional()
  @IsString()
  categorySlug?: string;

  @IsOptional()
  @IsObject()
  fieldsData?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  internalComment?: string;
}
