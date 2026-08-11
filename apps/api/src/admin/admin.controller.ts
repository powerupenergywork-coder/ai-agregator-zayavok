import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { IsBoolean, IsOptional, IsString } from "class-validator";
import { AdminService } from "./admin.service";
import { AdminAuthService } from "./admin-auth.service";
import { CategoriesService } from "../categories/categories.service";
import { AdminAuthGuard, AdminAuthUser } from "./admin-auth.guard";
import { CurrentAdmin } from "./current-admin.decorator";
import { LoginDto } from "./dto/login.dto";
import { UpsertCategoryDto } from "./dto/upsert-category.dto";
import { UpsertSupplierDto } from "./dto/upsert-supplier.dto";
import { ImportSuppliersDto } from "./dto/import-suppliers.dto";
import { UpdateDispatchSettingsDto } from "./dto/update-dispatch-settings.dto";
import { AdminEditOrderDto } from "./dto/admin-edit-order.dto";
import { InitiateProspectDto } from "./dto/initiate-prospect.dto";
import { DailyReportService } from "./daily-report.service";

class SetBlockedDto {
  @IsBoolean()
  blocked!: boolean;
}

class SetSubscriptionDto {
  @IsBoolean()
  active!: boolean;
}

class AdminCancelDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

@Controller("admin")
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly adminAuth: AdminAuthService,
    private readonly categories: CategoriesService,
    private readonly dailyReport: DailyReportService,
  ) {}

  /**
   * Собрать и отправить сводку прямо сейчас, не дожидаясь вечера.
   *
   * Нужна не для удобства, а для проверки: расписание срабатывает раз в
   * сутки, и ошибку в подсчётах иначе видно только на следующий день. Текст
   * возвращается в ответе, поэтому проверить содержимое можно даже когда
   * 24-часовое окно WhatsApp закрыто и отправка не проходит.
   */
  @UseGuards(AdminAuthGuard)
  @Post("daily-report/send")
  async sendDailyReport() {
    return { text: await this.dailyReport.send() };
  }

  @Post("auth/login")
  login(@Body() dto: LoginDto) {
    return this.adminAuth.login(dto.email, dto.password);
  }

  @UseGuards(AdminAuthGuard)
  @Get("categories")
  listCategories() {
    return this.categories.findAllForAdmin();
  }

  @UseGuards(AdminAuthGuard)
  @Post("categories")
  createCategory(@Body() dto: UpsertCategoryDto) {
    return this.categories.create({
      slug: dto.slug ?? slugify(dto.name.ru),
      name: dto.name,
      icon: dto.icon,
      examples: dto.examples,
      fields: dto.fields,
    });
  }

  @UseGuards(AdminAuthGuard)
  @Patch("categories/:id")
  updateCategory(@Param("id") id: string, @Body() dto: UpsertCategoryDto) {
    return this.categories.update(id, dto);
  }

  @UseGuards(AdminAuthGuard)
  @Get("suppliers")
  listSuppliers(
    @Query("categorySlug") categorySlug?: string,
    @Query("city") city?: string,
    @Query("blocked") blocked?: string,
  ) {
    return this.admin.listSuppliers({
      categorySlug,
      city,
      blocked: blocked === undefined ? undefined : blocked === "true",
    });
  }

  @UseGuards(AdminAuthGuard)
  @Post("suppliers")
  upsertSupplier(@CurrentAdmin() admin: AdminAuthUser, @Body() dto: UpsertSupplierDto) {
    return this.admin.upsertSupplier(dto, admin);
  }

  /** Defaults to a dry run — see AdminService.importSuppliers(). */
  @UseGuards(AdminAuthGuard)
  @Post("suppliers/import")
  importSuppliers(@CurrentAdmin() admin: AdminAuthUser, @Body() dto: ImportSuppliersDto) {
    return this.admin.importSuppliers(dto, admin);
  }

  @UseGuards(AdminAuthGuard)
  @Patch("suppliers/:id/block")
  setSupplierBlocked(
    @CurrentAdmin() admin: AdminAuthUser,
    @Param("id") id: string,
    @Body() dto: SetBlockedDto,
  ) {
    return this.admin.setSupplierBlocked(id, dto.blocked, admin);
  }

  /** Деньги по одному поставщику: подписка, счета, платежи. */
  @UseGuards(AdminAuthGuard)
  @Get("suppliers/:id/billing")
  supplierBilling(@Param("id") id: string) {
    return this.admin.supplierBilling(id);
  }

  /**
   * Выставить счёт руками. Обычно счёт появляется сам при исчерпании лимита,
   * но поставщик может попросить его заранее — по телефону, до всякого
   * лимита, — и оператору нужно чем-то ответить.
   */
  @UseGuards(AdminAuthGuard)
  @Post("suppliers/:id/invoice")
  issueInvoice(@CurrentAdmin() admin: AdminAuthUser, @Param("id") id: string) {
    return this.admin.issueInvoice(id, admin);
  }

  @UseGuards(AdminAuthGuard)
  @Patch("suppliers/:id/subscription")
  setSupplierSubscription(
    @CurrentAdmin() admin: AdminAuthUser,
    @Param("id") id: string,
    @Body() dto: SetSubscriptionDto,
  ) {
    return this.admin.setSupplierSubscription(id, dto.active, admin);
  }

  @UseGuards(AdminAuthGuard)
  @Get("orders")
  listOrders(@Query("status") status?: string, @Query("queue") queue?: string) {
    return this.admin.listOrders({ status, queue });
  }

  @UseGuards(AdminAuthGuard)
  @Patch("orders/:id")
  editOrder(@CurrentAdmin() admin: AdminAuthUser, @Param("id") id: string, @Body() dto: AdminEditOrderDto) {
    return this.admin.editOrder(id, dto, admin);
  }

  @UseGuards(AdminAuthGuard)
  @Post("orders/:id/redispatch")
  redispatch(@CurrentAdmin() admin: AdminAuthUser, @Param("id") id: string) {
    return this.admin.redispatch(id, admin);
  }

  @UseGuards(AdminAuthGuard)
  @Post("orders/:id/cancel")
  cancelOrder(@CurrentAdmin() admin: AdminAuthUser, @Param("id") id: string, @Body() dto: AdminCancelDto) {
    return this.admin.adminCancel(id, admin, dto.reason ?? "Отменено администратором");
  }

  @UseGuards(AdminAuthGuard)
  @Get("dispatch-settings")
  getDispatchSettings() {
    return this.admin.getDispatchSettings();
  }

  @UseGuards(AdminAuthGuard)
  @Patch("dispatch-settings")
  updateDispatchSettings(@CurrentAdmin() admin: AdminAuthUser, @Body() dto: UpdateDispatchSettingsDto) {
    return this.admin.updateDispatchSettings(dto, admin);
  }

  @UseGuards(AdminAuthGuard)
  @Get("prospects")
  listProspects(
    @Query("status") status?: string,
    @Query("city") city?: string,
    @Query("categorySlug") categorySlug?: string,
  ) {
    return this.admin.listProspects({ status, city, categorySlug });
  }

  @UseGuards(AdminAuthGuard)
  @Get("prospects/funnel")
  getProspectFunnel() {
    return this.admin.getProspectFunnel();
  }

  @UseGuards(AdminAuthGuard)
  @Post("prospects")
  initiateProspect(@CurrentAdmin() admin: AdminAuthUser, @Body() dto: InitiateProspectDto) {
    return this.admin.initiateProspect(dto, admin);
  }

  @UseGuards(AdminAuthGuard)
  @Get("orders/:id")
  orderDetails(@Param("id") id: string) {
    return this.admin.orderDetails(id);
  }

  @UseGuards(AdminAuthGuard)
  @Get("insights")
  insights() {
    return this.admin.insights();
  }

  /** Переписка — персональные данные, поэтому только под админским токеном
   * и по конкретному номеру: списка «все диалоги подряд» здесь намеренно нет. */
  @UseGuards(AdminAuthGuard)
  /** Список диалогов. filter: text | unrecognized | silent. */
  @UseGuards(AdminAuthGuard)
  @Get("conversations")
  conversations(@Query("filter") filter?: string) {
    return this.admin.conversations(filter);
  }

  @Get("conversation")
  conversation(@Query("phone") phone: string) {
    return this.admin.conversation(phone ?? "");
  }
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9а-яё\s-]/gi, "")
      .replace(/\s+/g, "-") + `-${Date.now().toString(36)}`
  );
}
