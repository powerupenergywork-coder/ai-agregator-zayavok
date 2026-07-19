import { Global, Module } from "@nestjs/common";
import { env } from "../config/env";
import { WHATSAPP_PROVIDER } from "./whatsapp-provider.interface";
import { ConsoleWhatsAppProvider } from "./console-whatsapp.provider";
import { GreenApiProvider } from "./green-api.provider";
import { CloudApiProvider } from "./cloud-api.provider";

function selectProvider() {
  switch (env.whatsappProvider) {
    case "green-api":
      return GreenApiProvider;
    case "cloud-api":
      return CloudApiProvider;
    default:
      return ConsoleWhatsAppProvider;
  }
}

@Global()
@Module({
  providers: [
    {
      provide: WHATSAPP_PROVIDER,
      useClass: selectProvider(),
    },
  ],
  exports: [WHATSAPP_PROVIDER],
})
export class WhatsAppProviderModule {}
