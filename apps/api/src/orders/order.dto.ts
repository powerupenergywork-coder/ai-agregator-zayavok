import { CategoryField, LocalizedText } from "@ai-zayavki/shared";

export interface OrderDto {
  id: string;
  number: number;
  publicToken: string;
  status: string;
  statusLabel: LocalizedText;
  urgent: boolean;
  category: { slug: string; name: LocalizedText; icon: string | null; fields: CategoryField[] } | null;
  fieldsData: Record<string, unknown>;
  /**
   * Слова клиента, которые не легли ни в одно поле.
   *
   * Заявка №132: на «Сухие смеси, вес 70кг» экстрактор записал «объём: не
   * знаю» — вес и был ответом, но в перечень значений он не помещался.
   * Справочник полей описывает заявку хуже, чем одна фраза заказчика,
   * поэтому фразу больше не выбрасываем, а показываем исполнителю.
   */
  description: string | null;
  progressPercent: number;
  addressFrom: string | null;
  addressTo: string | null;
  city: string | null;
  dateNeeded: Date | null;
  timeWindow: string | null;
  photos: string[];
  chatMessages: { role: string; content: string; createdAt: Date }[];
  /** Exposed once the order is published — this is how suppliers viewing
   * /s/:orderId know who to call, and it's how the client sees their own. */
  clientPhone: string | null;
  notifiedSuppliersCount: number;
  nextFields: CategoryField[];
  needsCategoryPick: boolean;
  clientRatingPositive: boolean | null;
  publishedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
}
