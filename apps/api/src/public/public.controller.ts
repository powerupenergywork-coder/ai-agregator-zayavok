import { Controller, Get } from "@nestjs/common";
import { PublicService } from "./public.service";

/** Без авторизации: страница для исполнителей открыта всем, её и гуглят. */
@Controller("public")
export class PublicController {
  constructor(private readonly service: PublicService) {}

  @Get("supplier-stats")
  supplierStats() {
    return this.service.supplierStats();
  }
}
