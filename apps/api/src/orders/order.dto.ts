import { CategoryField } from "@ai-zayavki/shared";

export interface OrderDto {
  id: string;
  number: number;
  publicToken: string;
  status: string;
  statusLabel: string;
  urgent: boolean;
  category: { slug: string; name: string; icon: string | null; fields: CategoryField[] } | null;
  fieldsData: Record<string, unknown>;
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
