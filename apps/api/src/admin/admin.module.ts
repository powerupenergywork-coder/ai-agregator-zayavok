import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { AdminAuthService } from "./admin-auth.service";
import { AdminAuthGuard } from "./admin-auth.guard";
import { CategoriesModule } from "../categories/categories.module";
import { OrdersModule } from "../orders/orders.module";
import { AuthOtpModule } from "../auth-otp/auth-otp.module";
import { BillingModule } from "../billing/billing.module";
import { AuditLogService } from "../common/audit-log.service";

@Module({
  imports: [
    BullModule.registerQueue({ name: "matching" }),
    CategoriesModule,
    OrdersModule,
    AuthOtpModule,
    BillingModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminAuthService, AdminAuthGuard, AuditLogService],
})
export class AdminModule {}
