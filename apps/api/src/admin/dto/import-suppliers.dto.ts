import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from "class-validator";

export class ImportSupplierRowDto {
  @IsString()
  phone!: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  /** One city and one category per row — the collection sheet repeats the
   * phone across rows rather than packing lists into a cell, and merging them
   * is the importer's job. */
  @IsString()
  city!: string;

  @IsString()
  categorySlug!: string;
}

export class ImportSuppliersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportSupplierRowDto)
  rows!: ImportSupplierRowDto[];

  /** Default true: an import that writes before anyone has seen the report is
   * how a typo'd spreadsheet becomes a hundred bad rows in production. */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
