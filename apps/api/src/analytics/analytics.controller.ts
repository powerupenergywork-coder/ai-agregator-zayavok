import { Body, Controller, Post } from "@nestjs/common";
import { IsIn, IsObject, IsOptional, IsString } from "class-validator";
import { AnalyticsService, AnalyticsEventType } from "./analytics.service";

const EVENT_TYPES: AnalyticsEventType[] = [
  "landing_view",
  "order_draft_started",
  "first_message_sent",
  "step_completed",
  "fill_abandoned",
  "otp_requested",
  "otp_verified",
  "order_published",
  "order_sent_to_suppliers",
  "order_cancelled",
  "order_completed",
  "repeat_order_created",
];

class TrackEventDto {
  @IsIn(EVENT_TYPES)
  eventType!: AnalyticsEventType;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsString()
  device?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Post("events")
  track(@Body() dto: TrackEventDto) {
    return this.analytics.track(dto.eventType, {
      orderId: dto.orderId,
      channel: dto.channel,
      device: dto.device,
      metadata: dto.metadata,
    });
  }
}
