import { Body, Controller, Ip, Post } from "@nestjs/common";
import { AuthOtpService } from "./auth-otp.service";
import { RequestCodeDto } from "./dto/request-code.dto";
import { VerifyCodeDto } from "./dto/verify-code.dto";
import { CheckDeviceDto } from "./dto/check-device.dto";

@Controller("auth")
export class AuthOtpController {
  constructor(private readonly authOtp: AuthOtpService) {}

  @Post("request-code")
  requestCode(@Body() dto: RequestCodeDto, @Ip() ip: string) {
    return this.authOtp.requestCode(dto.phone, dto.purpose, dto.deviceId, ip);
  }

  @Post("verify-code")
  verifyCode(@Body() dto: VerifyCodeDto) {
    return this.authOtp.verifyCode(dto.phone, dto.code, dto.purpose, dto.deviceId);
  }

  /** Lets the client skip the SMS round-trip entirely on a device verified recently. */
  @Post("check-device")
  checkDevice(@Body() dto: CheckDeviceDto) {
    return this.authOtp.checkTrustedDevice(dto.phone, dto.purpose, dto.deviceId);
  }
}
