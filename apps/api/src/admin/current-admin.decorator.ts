import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { AdminAuthUser } from "./admin-auth.guard";

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminAuthUser => {
    return ctx.switchToHttp().getRequest().adminUser;
  },
);
