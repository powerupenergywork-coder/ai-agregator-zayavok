import { Module } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { AdClickService } from "./ad-click.service";
import { AnalyticsController } from "./analytics.controller";

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AdClickService],
  exports: [AnalyticsService, AdClickService],
})
export class AnalyticsModule {}
