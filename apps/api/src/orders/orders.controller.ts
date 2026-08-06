import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { OrdersService } from "./orders.service";
import { CreateDraftDto } from "./dto/create-draft.dto";
import { ChatMessageDto } from "./dto/chat-message.dto";
import { SetFieldDto } from "./dto/set-field.dto";
import { CancelOrderDto } from "./dto/cancel-order.dto";
import { CompleteOrderDto } from "./dto/complete-order.dto";
import { RequestConfirmationDto } from "./dto/request-confirmation.dto";
import { JwtAuthGuard } from "../auth-otp/jwt-auth.guard";
import { CurrentUser } from "../auth-otp/current-user.decorator";
import { AuthUser } from "../auth-otp/jwt-auth.guard";

@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  createDraft(@Body() dto: CreateDraftDto) {
    return this.orders.createDraft(dto.categorySlug, dto.urgent, {
      source: dto.source,
      sourceParams: dto.sourceParams,
      landingPath: dto.landingPath,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get("mine")
  listMine(@CurrentUser() user: AuthUser) {
    return this.orders.listMine(user);
  }

  @Get("by-token/:token")
  getByToken(@Param("token") token: string) {
    return this.orders.getByPublicToken(token);
  }

  @Get(":id")
  getOne(@Param("id") id: string) {
    return this.orders.toDto(id);
  }

  @Post(":id/chat")
  chat(@Param("id") id: string, @Body() dto: ChatMessageDto) {
    return this.orders.chat(id, dto.message, dto.lang);
  }

  @Post(":id/category")
  pickCategory(
    @Param("id") id: string,
    @Body("categorySlug") categorySlug: string,
    @Body("lang") lang?: "ru" | "kk",
  ) {
    return this.orders.pickCategory(id, categorySlug, lang);
  }

  @Post(":id/fields")
  setField(@Param("id") id: string, @Body() dto: SetFieldDto) {
    return this.orders.setField(id, dto.key, dto.value, dto.lang);
  }

  @Post(":id/photos")
  @UseInterceptors(FileInterceptor("photo", { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  addPhoto(@Param("id") id: string, @UploadedFile() file: Express.Multer.File) {
    return this.orders.addPhoto(id, file.buffer, file.originalname, file.mimetype);
  }

  @UseGuards(JwtAuthGuard)
  @Post(":id/publish")
  publish(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.orders.requestPublishConfirmation(id, user);
  }

  /**
   * Public on purpose: the client has just filled in an order and typed
   * their number, and nothing is published until they tap the button that
   * arrives on that number. Demanding an OTP first asked them to prove the
   * same phone twice — see requestPublishConfirmationByPhone().
   */
  @Post(":id/request-confirmation")
  requestConfirmation(@Param("id") id: string, @Body() dto: RequestConfirmationDto) {
    return this.orders.requestPublishConfirmationByPhone(id, dto.phone);
  }

  /** Public: reached from the confirmUrl link in the order_confirm_request
   * SMS/WhatsApp text — see OrdersService.confirmPublishByToken(). */
  @Post("confirm-publish-by-token/:token")
  confirmPublishByToken(@Param("token") token: string) {
    return this.orders.confirmPublishByToken(token);
  }

  /** Public, keyed on the order's own unguessable token — the web client has
   * no JWT since the OTP step was removed. See ownerFromPublicToken(). */
  @Post("complete-by-token/:token")
  completeByToken(@Param("token") token: string, @Body() dto: CompleteOrderDto) {
    return this.orders.completeOrderByToken(token, dto.outcome, dto.comment);
  }

  @Post("cancel-by-token/:token")
  cancelByToken(@Param("token") token: string, @Body() dto: CancelOrderDto) {
    return this.orders.cancelByToken(token, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(":id/cancel")
  cancel(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() dto: CancelOrderDto) {
    return this.orders.cancel(id, user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(":id/complete")
  complete(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() dto: CompleteOrderDto) {
    return this.orders.completeOrder(id, user, dto.outcome, dto.comment);
  }

  @UseGuards(JwtAuthGuard)
  @Post(":id/repeat")
  repeat(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.orders.repeat(id, user);
  }
}
