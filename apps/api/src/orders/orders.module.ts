import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { OrdersService } from "./orders.service";
import { OrdersController } from "./orders.controller";
import { CategoriesModule } from "../categories/categories.module";
import { AiModule } from "../ai/ai.module";
import { StorageModule } from "../storage/storage.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { AuthOtpModule } from "../auth-otp/auth-otp.module";

@Module({
  imports: [
    BullModule.registerQueue({ name: "matching" }),
    CategoriesModule,
    AiModule,
    StorageModule,
    NotificationsModule,
    AnalyticsModule,
    AuthOtpModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
