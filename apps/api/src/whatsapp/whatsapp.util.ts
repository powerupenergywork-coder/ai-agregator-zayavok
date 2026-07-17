import { normalizePhone } from "../common/phone.util";

/** "+77011234567" -> "77011234567@c.us" (GREEN-API's chatId format for direct chats). */
export function phoneToChatId(phone: string): string {
  const digits = normalizePhone(phone).replace(/[^\d]/g, "");
  return `${digits}@c.us`;
}

/** "77011234567@c.us" -> "+77011234567" */
export function chatIdToPhone(chatId: string): string {
  const digits = chatId.split("@")[0];
  return normalizePhone(digits);
}
