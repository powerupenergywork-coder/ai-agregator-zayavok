import { IsArray, IsBoolean, IsObject, IsOptional, IsString } from "class-validator";
import { CategoryField, LocalizedText } from "@ai-zayavki/shared";

// name/examples are bilingual ({ru,kk}) — see packages/shared/src/language.ts.
// Editing category templates happens via direct API calls (PATCH /admin/categories/:id
// with a full JSON body), not a web form, so this stays loosely validated rather
// than adding a nested DTO class just for two fields.
export class UpsertCategoryDto {
  @IsOptional()
  @IsString()
  slug?: string;

  @IsObject()
  name!: LocalizedText;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsArray()
  examples!: LocalizedText[];

  @IsArray()
  fields!: CategoryField[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
