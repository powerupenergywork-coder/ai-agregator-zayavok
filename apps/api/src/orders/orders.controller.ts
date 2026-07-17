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
import { JwtAuthGuard } from "../auth-otp/jwt-auth.guard";
import { CurrentUser } from "../auth-otp/current-user.decorator";
import { AuthUser } from "../auth-otp/jwt-auth.guard";

@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  createDraft(@Body() dto: CreateDraftDto) {
    return this.orders.createDraft(dto.categorySlug, dto.urgent);
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
    return this.orders.chat(id, dto.message);
  }

  @Post(":id/category")
  pickCategory(@Param("id") id: string, @Body("categorySlug") categorySlug: string) {
    return this.orders.pickCategory(id, categorySlug);
  }

  @Post(":id/fields")
  setField(@Param("id") id: string, @Body() dto: SetFieldDto) {
    return this.orders.setField(id, dto.key, dto.value);
  }

  @Post(":id/photos")
  @UseInterceptors(FileInterceptor("photo", { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  addPhoto(@Param("id") id: string, @UploadedFile() file: Express.Multer.File) {
    return this.orders.addPhoto(id, file.buffer, file.originalname, file.mimetype);
  }

  @UseGuards(JwtAuthGuard)
  @Post(":id/publish")
  publish(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.orders.publish(id, user);
  }

  @UseGuards(JwtAuthGuard)
  @Post(":id/cancel")
  cancel(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() dto: CancelOrderDto) {
    return this.orders.cancel(id, user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(":id/complete")
  complete(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() dto: CompleteOrderDto) {
    return this.orders.completeOrder(id, user, dto.positive, dto.comment);
  }

  @UseGuards(JwtAuthGuard)
  @Post(":id/repeat")
  repeat(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.orders.repeat(id, user);
  }
}
