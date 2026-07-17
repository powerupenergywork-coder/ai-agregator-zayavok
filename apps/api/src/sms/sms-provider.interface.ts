export interface SmsProvider {
  send(phone: string, message: string): Promise<void>;
}

export const SMS_PROVIDER = Symbol("SMS_PROVIDER");
