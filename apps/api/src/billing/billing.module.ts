import { Module } from "@nestjs/common";
import { BillingService } from "./billing.service";
import { BillingController } from "./billing.controller";
import { PaymentProviderModule } from "./payment-provider.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AuthOtpModule } from "../auth-otp/auth-otp.module";

@Module({
  imports: [PaymentProviderModule, NotificationsModule, AuthOtpModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
