import { IsArray, IsBoolean, IsOptional, IsString } from "class-validator";

export class UpsertSupplierDto {
  @IsString()
  phone!: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsArray()
  categorySlugs!: string[];

  @IsArray()
  cities!: string[];

  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean;

  @IsOptional()
  @IsBoolean()
  acceptsUrgent?: boolean;
}
