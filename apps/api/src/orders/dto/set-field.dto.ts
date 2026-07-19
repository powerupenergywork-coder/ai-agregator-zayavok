import { IsDefined, IsIn, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { Language } from "@ai-zayavki/shared";

export class SetFieldDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  // Value can be string | number | boolean — validated loosely, the category
  // field type is the real source of truth on the frontend chip UI.
  // @IsDefined (not a shape check) is required so ValidationPipe's
  // whitelist:true doesn't strip this property — whitelist drops any field
  // with zero validation decorators before the handler ever sees it.
  @IsDefined()
  value: unknown;

  @IsOptional()
  @IsIn(["ru", "kk"])
  lang?: Language;
}
