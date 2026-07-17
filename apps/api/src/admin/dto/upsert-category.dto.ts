import { IsArray, IsBoolean, IsOptional, IsString } from "class-validator";
import { CategoryField } from "@ai-zayavki/shared";

export class UpsertCategoryDto {
  @IsOptional()
  @IsString()
  slug?: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsArray()
  examples!: string[];

  @IsArray()
  fields!: CategoryField[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
