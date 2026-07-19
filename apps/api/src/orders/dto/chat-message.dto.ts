import { IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { Language } from "@ai-zayavki/shared";

export class ChatMessageDto {
  @IsString()
  @MinLength(1)
  message!: string;

  @IsOptional()
  @IsIn(["ru", "kk"])
  lang?: Language;
}
