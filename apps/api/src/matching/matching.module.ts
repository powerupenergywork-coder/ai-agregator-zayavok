import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { MatchingService } from "./matching.service";
import { MatchingProcessor } from "./matching.processor";
import { OrdersModule } from "../orders/orders.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { BillingModule } from "../billing/billing.module";

@Module({
  imports: [
    BullModule.registerQueue({ name: "matching" }),
    OrdersModule,
    NotificationsModule,
    AnalyticsModule,
    BillingModule,
  ],
  providers: [MatchingService, MatchingProcessor],
  exports: [MatchingService],
})
export class MatchingModule {}
