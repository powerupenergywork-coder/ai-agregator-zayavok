import { IsString } from "class-validator";

export class InitiateProspectDto {
  @IsString()
  phone!: string;

  @IsString()
  orderId!: string;
}
