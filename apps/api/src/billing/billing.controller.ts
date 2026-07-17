import { Body, Controller, ForbiddenException, Get, Param, Post, UseGuards } from "@nestjs/common";
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

  /** Real Kaspi webhook receiver — signature verification is a TODO alongside kaspi-payment.provider.ts. */
  @Post("kaspi/webhook")
  async kaspiWebhook(@Body() body: { reference: string }) {
    await this.billing.confirmPayment(body.reference);
    return { ok: true };
  }
}

function assertSupplier(user: AuthUser) {
  if (user.role !== "supplier") throw new ForbiddenException("Доступно только поставщику");
}
