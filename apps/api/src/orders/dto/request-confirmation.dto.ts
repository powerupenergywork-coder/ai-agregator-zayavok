import { IsString, MinLength } from "class-validator";

export class RequestConfirmationDto {
  /** Loose on purpose — normalizePhone/isValidPhone in the service decide
   * what a real Kazakh number looks like, so the rule lives in one place. */
  @IsString()
  @MinLength(10)
  phone!: string;
}
