import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

export interface AdminAuthUser {
  sub: string;
  email: string;
  role: "ADMIN" | "OPERATOR";
  kind: "admin_user";
}

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException("Требуется авторизация администратора");
    try {
      const payload = await this.jwt.verifyAsync<AdminAuthUser>(header.slice("Bearer ".length));
      if (payload.kind !== "admin_user") throw new Error("wrong token kind");
      req.adminUser = payload;
      return true;
    } catch {
      throw new UnauthorizedException("Недействительный токен администратора");
    }
  }
}

