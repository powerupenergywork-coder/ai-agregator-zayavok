import { Global, Module } from "@nestjs/common";
import { env } from "../config/env";
import { WHATSAPP_PROVIDER } from "./whatsapp-provider.interface";
import { ConsoleWhatsAppProvider } from "./console-whatsapp.provider";
import { GreenApiProvider } from "./green-api.provider";

@Global()
@Module({
  providers: [
    {
      provide: WHATSAPP_PROVIDER,
      useClass: env.whatsappProvider === "green-api" ? GreenApiProvider : ConsoleWhatsAppProvider,
    },
  ],
  exports: [WHATSAPP_PROVIDER],
})
export class WhatsAppProviderModule {}
