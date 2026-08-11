import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { BullModule } from "@nestjs/bullmq";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule } from "@nestjs/throttler";
import { RealIpThrottlerGuard } from "./common/real-ip-throttler.guard";
import { env } from "./config/env";
import { PrismaModule } from "./prisma/prisma.module";
import { SmsModule } from "./sms/sms.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { AuthOtpModule } from "./auth-otp/auth-otp.module";
import { CategoriesModule } from "./categories/categories.module";
import { OrdersModule } from "./orders/orders.module";
import { MatchingModule } from "./matching/matching.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { PublicModule } from "./public/public.module";
import { AdminModule } from "./admin/admin.module";
import { WhatsAppModule } from "./whatsapp/whatsapp.module";
import { BillingModule } from "./billing/billing.module";
import { ProspectModule } from "./prospect/prospect.module";

const redisUrl = new URL(env.redisUrl);

@Module({
  imports: [
    PrismaModule,
    SmsModule,
    RealtimeModule,
    ScheduleModule.forRoot(),
    // Общий лимит на все маршруты. Отдельные endpoint'ы ужимают его через
    // @Throttle, а вебхуки снимают через @SkipThrottle — см. комментарии там.
    //
    // Счётчик живёт в памяти процесса. Контейнер с API один, так что этого
    // достаточно; если их станет несколько, лимит фактически умножится на их
    // число и счётчик надо будет переносить в Redis (он уже есть рядом).
    ThrottlerModule.forRoot([
      { name: "default", ttl: env.throttleWindowSeconds * 1000, limit: env.throttleLimit },
    ]),
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
    PublicModule,
    WhatsAppModule,
    BillingModule,
    ProspectModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: RealIpThrottlerGuard }],
})
export class AppModule {}
