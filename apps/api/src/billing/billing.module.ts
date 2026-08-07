import { Module } from "@nestjs/common";
import { BillingService } from "./billing.service";
import { BillingController } from "./billing.controller";
import { KaspiBillerService } from "./kaspi-biller.service";
import { KaspiBillerController } from "./kaspi-biller.controller";
import { PaymentProviderModule } from "./payment-provider.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AuthOtpModule } from "../auth-otp/auth-otp.module";

@Module({
  imports: [PaymentProviderModule, NotificationsModule, AuthOtpModule],
  controllers: [BillingController, KaspiBillerController],
  providers: [BillingService, KaspiBillerService],
  exports: [BillingService],
})
export class BillingModule {}
