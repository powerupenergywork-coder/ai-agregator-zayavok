import { Body, Controller, Ip, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { env } from "../config/env";
import { AuthOtpService } from "./auth-otp.service";
import { RequestCodeDto } from "./dto/request-code.dto";
import { VerifyCodeDto } from "./dto/verify-code.dto";
import { CheckDeviceDto } from "./dto/check-device.dto";

@Controller("auth")
export class AuthOtpController {
  constructor(private readonly authOtp: AuthOtpService) {}

  /**
   * Самый дорогой маршрут в проекте: каждый вызов — это отправленная SMS или
   * сообщение WhatsApp, то есть списанные деньги.
   *
   * Пауза на повтор по одному номеру (OTP_RESEND_COOLDOWN_SECONDS) тут не
   * помогает: она не мешает подставлять в цикле разные номера, и счёт за
   * рассылку по чужим телефонам придёт нам. Лимит считается по адресу
   * отправителя и режет именно перебор.
   */
  @Throttle({ default: { limit: env.throttleLimitOtp, ttl: env.throttleWindowSeconds * 1000 } })
  @Post("request-code")
  requestCode(@Body() dto: RequestCodeDto, @Ip() ip: string) {
    return this.authOtp.requestCode(dto.phone, dto.purpose, dto.deviceId, ip, dto.lang);
  }

  @Post("verify-code")
  verifyCode(@Body() dto: VerifyCodeDto) {
    return this.authOtp.verifyCode(dto.phone, dto.code, dto.purpose, dto.deviceId, dto.lang);
  }

  /** Lets the client skip the SMS round-trip entirely on a device verified recently. */
  @Post("check-device")
  checkDevice(@Body() dto: CheckDeviceDto) {
    return this.authOtp.checkTrustedDevice(dto.phone, dto.purpose, dto.deviceId);
  }
}
