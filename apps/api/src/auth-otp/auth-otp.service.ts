import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { createHash, randomInt } from "crypto";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { env } from "../config/env";
import { normalizePhone, isValidPhone } from "../common/phone.util";
import { SMS_PROVIDER, SmsProvider } from "../sms/sms-provider.interface";
import { WHATSAPP_PROVIDER, WhatsAppProvider } from "../whatsapp/whatsapp-provider.interface";

type Purpose = "CLIENT_LOGIN" | "SUPPLIER_LOGIN";

export interface AuthResult {
  token: string;
  userId: string;
  role: "client" | "supplier";
  profileId: string;
  isNewProfile: boolean;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

@Injectable()
export class AuthOtpService {
  private readonly logger = new Logger(AuthOtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
  ) {}

  async requestCode(rawPhone: string, purpose: Purpose, deviceId: string, ip?: string) {
    const phone = normalizePhone(rawPhone);
    if (!isValidPhone(phone)) {
      throw new BadRequestException("Некорректный номер телефона");
    }

    const cooldownStart = new Date(Date.now() - env.otpResendCooldownSeconds * 1000);
    const recent = await this.prisma.otpCode.findFirst({
      where: { phone, purpose, createdAt: { gt: cooldownStart } },
      orderBy: { createdAt: "desc" },
    });
    if (recent) {
      const retryInSeconds = Math.ceil(
        (recent.createdAt.getTime() + env.otpResendCooldownSeconds * 1000 - Date.now()) / 1000,
      );
      throw new HttpException(
        `Повторный код можно запросить через ${Math.max(retryInSeconds, 1)} сек.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Anti-fraud: cap total codes per phone per rolling 24h (п.25 ТЗ).
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const countLast24h = await this.prisma.otpCode.count({
      where: { phone, createdAt: { gt: dayAgo } },
    });
    if (countLast24h >= 10) {
      throw new HttpException(
        "Превышен дневной лимит запросов кода для этого номера",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.prisma.otpCode.create({
      data: {
        phone,
        purpose,
        code: hashCode(code),
        expiresAt: new Date(Date.now() + env.otpCodeTtlSeconds * 1000),
        ipAddress: ip,
        deviceId,
      },
    });

    // WhatsApp first — cheaper and the channel clients already expect, per
    // product decision. Falls back to SMS if delivery fails, or if the
    // number simply has no WhatsApp account — sendText() doesn't error for
    // that case (the platform just silently never delivers), so it has to be
    // checked explicitly instead of relying on a thrown exception. Note the
    // trade-off: WebOTP auto-fill on the web form only works for real SMS —
    // a WhatsApp-delivered code has to be typed in by hand, browsers have no
    // way to read WhatsApp messages.
    let channel: "whatsapp" | "sms" = "whatsapp";
    let hasWhatsapp = true;
    try {
      hasWhatsapp = await this.whatsapp.checkExists(phone);
    } catch (err) {
      // Couldn't determine either way (e.g. provider network error) —
      // assume yes and let the send attempt below be the real signal, same
      // as before this check existed.
      this.logger.warn(`WhatsApp checkExists failed for ${phone}, assuming it has WhatsApp: ${(err as Error).message}`);
    }

    if (hasWhatsapp) {
      try {
        await this.whatsapp.sendText(phone, `Ваш код подтверждения: ${code}`);
      } catch (err) {
        this.logger.warn(`WhatsApp OTP delivery failed for ${phone}, falling back to SMS: ${(err as Error).message}`);
        hasWhatsapp = false;
      }
    }

    if (!hasWhatsapp) {
      channel = "sms";
      await this.sms.send(phone, `Ваш код подтверждения: ${code}`);
    }

    return {
      expiresInSeconds: env.otpCodeTtlSeconds,
      resendCooldownSeconds: env.otpResendCooldownSeconds,
      channel,
    };
  }

  async verifyCode(
    rawPhone: string,
    code: string,
    purpose: Purpose,
    deviceId: string,
  ): Promise<AuthResult> {
    const phone = normalizePhone(rawPhone);

    const otp = await this.prisma.otpCode.findFirst({
      where: { phone, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) {
      throw new BadRequestException("Код не найден или истёк, запросите новый");
    }
    if (otp.attempts >= env.otpMaxAttempts) {
      throw new BadRequestException("Превышено число попыток, запросите новый код");
    }
    if (otp.code !== hashCode(code)) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException("Неверный код");
    }

    await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });

    return this.issueSessionForPhone(phone, purpose, deviceId);
  }

  /**
   * Trusted-device fast path: if this phone+device verified successfully within
   * TRUSTED_DEVICE_DAYS, skip SMS entirely — this is the "repeat order in
   * seconds" flow we designed. Anything about the device/IP changing pushes
   * back to a full OTP challenge.
   */
  async checkTrustedDevice(rawPhone: string, purpose: Purpose, deviceId: string) {
    const phone = normalizePhone(rawPhone);
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) return { trusted: false as const };

    const trusted = await this.prisma.trustedDevice.findFirst({
      where: { userId: user.id, deviceId, expiresAt: { gt: new Date() } },
    });
    if (!trusted) return { trusted: false as const };

    const result = await this.issueSessionForPhone(phone, purpose, deviceId, false);
    return { trusted: true as const, ...result };
  }

  /**
   * WhatsApp path only — GREEN-API already proves phone ownership (the
   * message came from that number), so we skip SMS/OTP entirely and just
   * upsert the User/ClientProfile directly. Never expose this over HTTP for
   * arbitrary phone numbers; only whatsapp-router.service.ts calls it, and
   * only for the phone number a webhook actually came from.
   */
  async getOrCreateClientAuthUser(phone: string): Promise<{ sub: string; phone: string; role: "client"; profileId: string }> {
    const normalized = normalizePhone(phone);
    const user = await this.prisma.user.upsert({
      where: { phone: normalized },
      create: { phone: normalized, preferredChannel: "WHATSAPP" },
      update: { preferredChannel: "WHATSAPP" },
    });
    let profile = await this.prisma.clientProfile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      profile = await this.prisma.clientProfile.create({ data: { userId: user.id } });
    }
    return { sub: user.id, phone: normalized, role: "client", profileId: profile.id };
  }

  /** Same as getOrCreateClientAuthUser but for a supplier tapping "Беру заказ" in WhatsApp. */
  async getOrCreateSupplierAuthUser(phone: string): Promise<{ sub: string; phone: string; role: "supplier"; profileId: string }> {
    const normalized = normalizePhone(phone);
    const user = await this.prisma.user.upsert({
      where: { phone: normalized },
      create: { phone: normalized, preferredChannel: "WHATSAPP" },
      update: { preferredChannel: "WHATSAPP" },
    });
    let profile = await this.prisma.supplierProfile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      profile = await this.prisma.supplierProfile.create({ data: { userId: user.id, needsReview: true } });
    }
    return { sub: user.id, phone: normalized, role: "supplier", profileId: profile.id };
  }

  private async issueSessionForPhone(
    phone: string,
    purpose: Purpose,
    deviceId: string,
    refreshTrustedDevice = true,
  ): Promise<AuthResult> {
    const user = await this.prisma.user.upsert({
      where: { phone },
      create: { phone },
      update: {},
    });

    let role: "client" | "supplier";
    let profileId: string;
    let isNewProfile = false;

    if (purpose === "CLIENT_LOGIN") {
      let profile = await this.prisma.clientProfile.findUnique({ where: { userId: user.id } });
      if (!profile) {
        profile = await this.prisma.clientProfile.create({ data: { userId: user.id } });
        isNewProfile = true;
      }
      role = "client";
      profileId = profile.id;
    } else {
      let profile = await this.prisma.supplierProfile.findUnique({ where: { userId: user.id } });
      if (!profile) {
        profile = await this.prisma.supplierProfile.create({ data: { userId: user.id } });
        isNewProfile = true;
      }
      role = "supplier";
      profileId = profile.id;
    }

    if (refreshTrustedDevice) {
      await this.prisma.trustedDevice.upsert({
        where: { userId_deviceId: { userId: user.id, deviceId } },
        create: {
          userId: user.id,
          deviceId,
          expiresAt: new Date(Date.now() + env.trustedDeviceDays * 24 * 60 * 60 * 1000),
        },
        update: {
          verifiedAt: new Date(),
          expiresAt: new Date(Date.now() + env.trustedDeviceDays * 24 * 60 * 60 * 1000),
        },
      });
    }

    const token = await this.jwt.signAsync({
      sub: user.id,
      phone: user.phone,
      role,
      profileId,
    });

    return { token, userId: user.id, role, profileId, isNewProfile };
  }
}
