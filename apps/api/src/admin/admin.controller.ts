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
import { UpdateDispatchSettingsDto } from "./dto/update-dispatch-settings.dto";
import { AdminEditOrderDto } from "./dto/admin-edit-order.dto";

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
  ) {}

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
      slug: dto.slug ?? slugify(dto.name),
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

  @UseGuards(AdminAuthGuard)
  @Patch("suppliers/:id/block")
  setSupplierBlocked(
    @CurrentAdmin() admin: AdminAuthUser,
    @Param("id") id: string,
    @Body() dto: SetBlockedDto,
  ) {
    return this.admin.setSupplierBlocked(id, dto.blocked, admin);
  }

  @UseGuards(AdminAuthGuard)
  @Patch("suppliers/:id/review")
  markSupplierReviewed(@CurrentAdmin() admin: AdminAuthUser, @Param("id") id: string) {
    return this.admin.markSupplierReviewed(id, admin);
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
