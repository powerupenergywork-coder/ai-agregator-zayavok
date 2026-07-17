import { Injectable, Logger } from "@nestjs/common";
import { SmsProvider } from "./sms-provider.interface";

/**
 * Dev-mode SMS "provider" — logs to the API console instead of sending a real
 * SMS. Swap SMS_PROVIDER=mobizon (or another real adapter) in .env once a KZ
 * SMS gateway account exists; see mobizon-sms.provider.ts for the stub.
 */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger("SMS(console)");

  async send(phone: string, message: string): Promise<void> {
    this.logger.log(`→ ${phone}: ${message}`);
  }
}
