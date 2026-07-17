import { Module } from "@nestjs/common";
import { WhatsAppController } from "./whatsapp.controller";
import { WhatsAppRouterService } from "./whatsapp-router.service";
import { WhatsAppSessionService } from "./whatsapp-session.service";
import { WhatsAppOnboardingService } from "./whatsapp-onboarding.service";
import { WhatsAppProviderModule } from "./whatsapp-provider.module";
import { OrdersModule } from "../orders/orders.module";
import { AuthOtpModule } from "../auth-otp/auth-otp.module";
import { CategoriesModule } from "../categories/categories.module";
import { BillingModule } from "../billing/billing.module";
import { AuditLogService } from "../common/audit-log.service";

@Module({
  imports: [WhatsAppProviderModule, OrdersModule, AuthOtpModule, CategoriesModule, BillingModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppRouterService, WhatsAppSessionService, WhatsAppOnboardingService, AuditLogService],
})
export class WhatsAppModule {}
