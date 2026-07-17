import { IsIn, IsString, MinLength } from "class-validator";

export class CheckDeviceDto {
  @IsString()
  @MinLength(5)
  phone!: string;

  @IsIn(["CLIENT_LOGIN", "SUPPLIER_LOGIN"])
  purpose!: "CLIENT_LOGIN" | "SUPPLIER_LOGIN";

  @IsString()
  deviceId!: string;
}
