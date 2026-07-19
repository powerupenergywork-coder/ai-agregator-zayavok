import { IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { Language } from "@ai-zayavki/shared";

export class RequestCodeDto {
  @IsString()
  @MinLength(5)
  phone!: string;

  @IsIn(["CLIENT_LOGIN", "SUPPLIER_LOGIN"])
  purpose!: "CLIENT_LOGIN" | "SUPPLIER_LOGIN";

  @IsString()
  deviceId!: string;

  @IsOptional()
  @IsIn(["ru", "kk"])
  lang?: Language;
}
