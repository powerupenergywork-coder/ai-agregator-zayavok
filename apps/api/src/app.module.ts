import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ScheduleModule } from "@nestjs/schedule";
import { env } from "./config/env";
import { PrismaModule } from "./prisma/prisma.module";
import { SmsModule } from "./sms/sms.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { AuthOtpModule } from "./auth-otp/auth-otp.module";
import { CategoriesModule } from "./categories/categories.module";
import { OrdersModule } from "./orders/orders.module";
import { MatchingModule } from "./matching/matching.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AdminModule } from "./admin/admin.module";
import { WhatsAppModule } from "./whatsapp/whatsapp.module";
import { BillingModule } from "./billing/billing.module";

const redisUrl = new URL(env.redisUrl);

@Module({
  imports: [
    PrismaModule,
    SmsModule,
    RealtimeModule,
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      connection: {
        host: redisUrl.hostname,
        port: Number(redisUrl.port || 6379),
        password: redisUrl.password || undefined,
      },
    }),
    AuthOtpModule,
    CategoriesModule,
    OrdersModule,
    MatchingModule,
    AnalyticsModule,
    AdminModule,
    WhatsAppModule,
    BillingModule,
  ],
})
export class AppModule {}
