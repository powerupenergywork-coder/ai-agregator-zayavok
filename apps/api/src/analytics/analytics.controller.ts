import { Body, Controller, Post } from "@nestjs/common";
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from "class-validator";
import { AnalyticsService, AnalyticsEventType } from "./analytics.service";
import { AdClickService } from "./ad-click.service";

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
  constructor(private readonly analytics: AnalyticsService,
    private readonly adClicks: AdClickService) {}

  @Post("events")
  track(@Body() dto: TrackEventDto) {
    return this.analytics.track(dto.eventType, {
      orderId: dto.orderId,
      channel: dto.channel,
      device: dto.device,
      metadata: dto.metadata,
    });
  }
  /**
   * Обменять идентификатор клика на короткий код для WhatsApp.
   *
   * Вызывается посадочной страницей, когда в адресе есть gclid. Ответ уходит
   * в предзаполненный текст кнопки: длинный gclid туда не помещается, а
   * человек читает этот текст своими глазами.
   *
   * Ошибку наружу не отдаём: не получилось выдать код — кнопка просто ведёт
   * в WhatsApp без метки, как раньше. Атрибуция важна нам, а не клиенту.
   */
  @Post("ad-click")
  async adClick(@Body() dto: AdClickDto): Promise<{ token: string | null }> {
    const token = await this.adClicks.issue(dto.clickId, dto.source ?? "google", dto.params);
    return { token };
  }
}

class AdClickDto {
  @IsString()
  @MaxLength(200)
  clickId!: string;

  @IsOptional()
  @IsIn(["google", "yandex"])
  source?: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, string>;
}
