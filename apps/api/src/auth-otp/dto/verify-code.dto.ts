import { IsIn, IsOptional, IsString, Length, MinLength } from "class-validator";
import { Language } from "@ai-zayavki/shared";

export class VerifyCodeDto {
  @IsString()
  @MinLength(5)
  phone!: string;

  @IsString()
  @Length(4, 8)
  code!: string;

  @IsIn(["CLIENT_LOGIN", "SUPPLIER_LOGIN"])
  purpose!: "CLIENT_LOGIN" | "SUPPLIER_LOGIN";

  @IsString()
  deviceId!: string;

  @IsOptional()
  @IsIn(["ru", "kk"])
  lang?: Language;
}
