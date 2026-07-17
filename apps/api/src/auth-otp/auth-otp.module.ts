import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { env } from "../config/env";
import { AuthOtpService } from "./auth-otp.service";
import { AuthOtpController } from "./auth-otp.controller";
import { JwtAuthGuard } from "./jwt-auth.guard";

@Module({
  imports: [
    JwtModule.register({
      secret: env.jwtSecret,
      signOptions: { expiresIn: "30d" },
    }),
  ],
  controllers: [AuthOtpController],
  providers: [AuthOtpService, JwtAuthGuard],
  exports: [AuthOtpService, JwtAuthGuard, JwtModule],
})
export class AuthOtpModule {}
