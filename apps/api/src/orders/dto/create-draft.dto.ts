import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateDraftDto {
  @IsOptional()
  @IsString()
  categorySlug?: string;

  @IsOptional()
  @IsBoolean()
  urgent?: boolean;

  /** Нормализованный канал: "google", "2gis", "instagram", "direct"… */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string;

  /** Сырые метки ссылки — на случай, если понадобится разобрать кампанию. */
  @IsOptional()
  @IsObject()
  sourceParams?: Record<string, string>;

  /** Страница, с которой человек начал: главная или посадочная под услугу. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  landingPath?: string;
}
