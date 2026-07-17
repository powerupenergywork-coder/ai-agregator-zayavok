import { Global, Module } from "@nestjs/common";
import { env } from "../config/env";
import { SMS_PROVIDER } from "./sms-provider.interface";
import { ConsoleSmsProvider } from "./console-sms.provider";
import { MobizonSmsProvider } from "./mobizon-sms.provider";

@Global()
@Module({
  providers: [
    {
      provide: SMS_PROVIDER,
      useClass: env.smsProvider === "mobizon" ? MobizonSmsProvider : ConsoleSmsProvider,
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
