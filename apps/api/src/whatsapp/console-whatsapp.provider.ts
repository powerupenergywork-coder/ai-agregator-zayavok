import { Injectable, Logger } from "@nestjs/common";
import { WhatsAppButton, WhatsAppProvider } from "./whatsapp-provider.interface";

/** Dev-mode stand-in — logs instead of calling a real WhatsApp API, same role as ConsoleSmsProvider. */
@Injectable()
export class ConsoleWhatsAppProvider implements WhatsAppProvider {
  private readonly logger = new Logger("WhatsApp(console)");

  async sendText(phone: string, text: string): Promise<void> {
    this.logger.log(`→ ${phone}: ${text}`);
  }

  async sendButtons(phone: string, body: string, buttons: WhatsAppButton[]): Promise<void> {
    const buttonsText = buttons.map((b) => `[${b.text} -> ${b.id}]`).join("  ");
    this.logger.log(`→ ${phone}: ${body}\n  buttons: ${buttonsText}`);
  }

  async downloadMedia(url: string): Promise<Buffer> {
    throw new Error(`ConsoleWhatsAppProvider cannot download media in dev mode (url: ${url})`);
  }

  async checkExists(): Promise<boolean> {
    return true;
  }
}
