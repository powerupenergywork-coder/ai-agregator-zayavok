import { Controller, ForbiddenException, Get, Param, Post, UseGuards } from "@nestjs/common";
import { BillingService } from "./billing.service";
import { env, kaspiBillerActive, paymentsEnabled } from "../config/env";
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
    // Без настоящего провайдера этот вызов вернул бы ссылку мок-оплаты,
    // то есть бесплатную подписку любому, кто дойдёт до эндпоинта в обход
    // сообщений бота. Пока платить нечем — оформляет оператор из админки.
    if (!paymentsEnabled()) {
      throw new ForbiddenException(`Оплата пока не подключена. Напишите нам: ${env.supportPhone}`);
    }
    // У Kaspi ссылки не существует: деньги вносятся внутри приложения банка,
    // а нам приходит уже совершённый платёж. Возвращать сюда что-либо
    // «похожее на ссылку» было бы выдумкой.
    if (kaspiBillerActive()) {
      throw new ForbiddenException(
        `Оплата через Kaspi.kz → Платежи → «${env.kaspiServiceName}». Введите свой номер телефона.`,
      );
    }
    return this.billing.requestSubscription(user.profileId);
  }

  /**
   * Dev-only "checkout page" for PAYMENT_PROVIDER=mock — opening the link IS
   * the payment, поэтому в проде он закрыт независимо от провайдера. Прежняя
   * проверка (только `provider === "mock"`) означала ровно обратное: эндпоинт
   * работал именно там, где мок и стоит, — на боевом сервере.
   */
  @Get("mock-confirm/:reference")
  async mockConfirm(@Param("reference") reference: string) {
    if (env.paymentProvider !== "mock" || env.nodeEnv === "production") {
      throw new ForbiddenException("Недоступно");
    }
    await this.billing.confirmPayment(reference);
    return { ok: true, message: "Подписка активирована (тестовый платёж)" };
  }

}

function assertSupplier(user: AuthUser) {
  if (user.role !== "supplier") throw new ForbiddenException("Доступно только поставщику");
}
