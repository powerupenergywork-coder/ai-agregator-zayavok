export interface IncomingWhatsAppMessage {
  chatId: string;
  phone: string;
  text?: string;
  buttonReplyId?: string;
  imageUrl?: string;
}
