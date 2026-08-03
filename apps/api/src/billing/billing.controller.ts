import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { timingSafeEqual } from "crypto";
import { BillingService } from "./billing.service";
import { env } from "../config/env";
import { JwtAuthGuard } from "../auth-otp/jwt-auth.guard";
import { CurrentUser } from "../auth-otp/current-user.decorator";
import { AuthUser } from "../auth-otp/jwt-auth.guard";

@Controller("billing")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @UseGuards(JwtAuthGuard)
  @Get("status")
  getStatus(@CurrentUser() user: AuthUser) {
    assertSupplier(user);
    return this.billing.getStatus(user.profileId);
  }

  @UseGuards(JwtAuthGuard)
  @Post("subscribe")
  subscribe(@CurrentUser() user: AuthUser) {
    assertSupplier(user);
    return this.billing.requestSubscription(user.profileId);
  }

  /** Dev-only "checkout page" for PAYMENT_PROVIDER=mock — opening the link IS the payment. */
  @Get("mock-confirm/:reference")
  async mockConfirm(@Param("reference") reference: string) {
    if (env.paymentProvider !== "mock") {
      throw new ForbiddenException("Доступно только в режиме PAYMENT_PROVIDER=mock");
    }
    await this.billing.confirmPayment(reference);
    return { ok: true, message: "Подписка активирована (тестовый платёж)" };
  }

  /**
   * Kaspi payment callback. Authenticated by a shared secret, because the
   * only thing this endpoint needs to grant a paid subscription is a
   * reference — and the supplier who requested the payment already has
   * theirs. Without the check, "subscribe" and "pay" are the same button.
   */
  @Post("kaspi/webhook")
  async kaspiWebhook(
    @Body() body: { reference: string },
    @Headers("x-kaspi-signature") signature?: string,
  ) {
    if (!env.kaspiWebhookSecret) {
      throw new ForbiddenException("KASPI_WEBHOOK_SECRET не настроен — приём платежей отключён");
    }
    const expected = Buffer.from(env.kaspiWebhookSecret);
    const got = Buffer.from(signature ?? "");
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
      throw new UnauthorizedException("Неверная подпись");
    }
    if (!body?.reference) throw new ForbiddenException("Не указан reference");
    await this.billing.confirmPayment(body.reference);
    return { ok: true };
  }
}

function assertSupplier(user: AuthUser) {
  if (user.role !== "supplier") throw new ForbiddenException("Доступно только поставщику");
}
