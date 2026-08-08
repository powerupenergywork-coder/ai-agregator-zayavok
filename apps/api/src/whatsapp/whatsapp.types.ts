/**
 * Клик по рекламе Click-to-WhatsApp. Meta кладёт этот объект в ПЕРВОЕ
 * сообщение после клика по объявлению в Instagram или Facebook — и больше
 * никогда, поэтому его нужно сохранить сразу, а не когда дойдёт до заявки.
 */
export interface WhatsAppReferral {
  /** "ad" — объявление, "post" — обычный пост со страницы. */
  sourceType?: string;
  /** id объявления или поста: по нему кампания находится в Ads Manager. */
  sourceId?: string;
  sourceUrl?: string;
  /** Заголовок объявления — видно в админке без похода в кабинет. */
  headline?: string;
  /** Click ID Meta: нужен, если позже будем отдавать конверсии обратно. */
  ctwaClid?: string;
}

export interface IncomingWhatsAppMessage {
  chatId: string;
  phone: string;
  text?: string;
  buttonReplyId?: string;
  imageUrl?: string;
  referral?: WhatsAppReferral;
}
