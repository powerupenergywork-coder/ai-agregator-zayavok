import type { CategoryField, Language, LocalizedText } from "@ai-zayavki/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.message || message;
    } catch {
      // ignore non-JSON error body
    }
    throw new ApiError(Array.isArray(message) ? message.join(", ") : message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---------- shared types ----------

export interface CategorySummary {
  slug: string;
  name: LocalizedText;
  icon?: string;
  examples: LocalizedText[];
}

export interface CategoryTemplateDto extends CategorySummary {
  fields: CategoryField[];
}

export interface OrderDto {
  id: string;
  number: number;
  publicToken: string;
  status: string;
  statusLabel: LocalizedText;
  urgent: boolean;
  category: { slug: string; name: LocalizedText; icon: string | null; fields: CategoryField[] } | null;
  fieldsData: Record<string, unknown>;
  progressPercent: number;
  addressFrom: string | null;
  addressTo: string | null;
  city: string | null;
  dateNeeded: string | null;
  timeWindow: string | null;
  photos: string[];
  chatMessages: { role: string; content: string; createdAt: string }[];
  clientPhone: string | null;
  notifiedSuppliersCount: number;
  nextFields: CategoryField[];
  needsCategoryPick: boolean;
  clientRatingPositive: boolean | null;
  publishedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface ChatTurnResponse {
  order: OrderDto;
  assistantMessage: string;
  needsCategoryPick: boolean;
  categories?: CategorySummary[];
  nextFields: CategoryField[];
  isReadyForReview: boolean;
}

export interface AuthResult {
  token: string;
  userId: string;
  role: "client" | "supplier";
  profileId: string;
  isNewProfile: boolean;
}

// ---------- auth ----------

export const authApi = {
  requestCode: (phone: string, purpose: "CLIENT_LOGIN" | "SUPPLIER_LOGIN", deviceId: string, lang?: Language) =>
    request<{ expiresInSeconds: number; resendCooldownSeconds: number; channel: "whatsapp" | "sms" }>(
      "/auth/request-code",
      { method: "POST", body: JSON.stringify({ phone, purpose, deviceId, lang }) },
    ),
  verifyCode: (phone: string, code: string, purpose: "CLIENT_LOGIN" | "SUPPLIER_LOGIN", deviceId: string, lang?: Language) =>
    request<AuthResult>("/auth/verify-code", {
      method: "POST",
      body: JSON.stringify({ phone, code, purpose, deviceId, lang }),
    }),
  checkDevice: (phone: string, purpose: "CLIENT_LOGIN" | "SUPPLIER_LOGIN", deviceId: string) =>
    request<{ trusted: boolean } & Partial<AuthResult>>("/auth/check-device", {
      method: "POST",
      body: JSON.stringify({ phone, purpose, deviceId }),
    }),
};

// ---------- orders ----------

export const ordersApi = {
  createDraft: (categorySlug?: string, urgent?: boolean) =>
    request<OrderDto>("/orders", { method: "POST", body: JSON.stringify({ categorySlug, urgent }) }),
  get: (id: string) => request<OrderDto>(`/orders/${id}`),
  chat: (id: string, message: string, lang?: Language) =>
    request<ChatTurnResponse>(`/orders/${id}/chat`, { method: "POST", body: JSON.stringify({ message, lang }) }),
  pickCategory: (id: string, categorySlug: string, lang?: Language) =>
    request<ChatTurnResponse>(`/orders/${id}/category`, { method: "POST", body: JSON.stringify({ categorySlug, lang }) }),
  setField: (id: string, key: string, value: unknown, lang?: Language) =>
    request<ChatTurnResponse>(`/orders/${id}/fields`, { method: "POST", body: JSON.stringify({ key, value, lang }) }),
  uploadPhoto: (id: string, file: File) => {
    const form = new FormData();
    form.append("photo", file);
    return request<OrderDto>(`/orders/${id}/photos`, { method: "POST", body: form });
  },
  publish: (id: string, token: string) => request<OrderDto>(`/orders/${id}/publish`, { method: "POST" }, token),
  getByToken: (token: string) => request<OrderDto>(`/orders/by-token/${token}`),
  confirmPublishByToken: (token: string) =>
    request<OrderDto>(`/orders/confirm-publish-by-token/${token}`, { method: "POST" }),
  cancel: (id: string, token: string, reason: string, comment?: string) =>
    request<OrderDto>(`/orders/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason, comment }) }, token),
  complete: (id: string, token: string, positive: boolean, comment?: string) =>
    request<OrderDto>(`/orders/${id}/complete`, { method: "POST", body: JSON.stringify({ positive, comment }) }, token),
  repeat: (id: string, token: string) => request<OrderDto>(`/orders/${id}/repeat`, { method: "POST" }, token),
  listMine: (token: string) =>
    request<
      { id: string; number: number; status: string; statusLabel: LocalizedText; categoryName: LocalizedText | null; createdAt: string }[]
    >("/orders/mine", {}, token),
};

// ---------- categories ----------

export const categoriesApi = {
  listActive: () => request<CategoryTemplateDto[]>("/categories"),
};

// ---------- admin ----------

export const adminApi = {
  login: (email: string, password: string) =>
    request<{ token: string; role: string; name: string | null }>("/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  listCategories: (token: string) => request<any[]>("/admin/categories", {}, token),
  createCategory: (token: string, body: unknown) =>
    request("/admin/categories", { method: "POST", body: JSON.stringify(body) }, token),
  updateCategory: (token: string, id: string, body: unknown) =>
    request(`/admin/categories/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token),
  listSuppliers: (token: string) => request<any[]>("/admin/suppliers", {}, token),
  upsertSupplier: (token: string, body: unknown) =>
    request("/admin/suppliers", { method: "POST", body: JSON.stringify(body) }, token),
  setSupplierBlocked: (token: string, id: string, blocked: boolean) =>
    request(`/admin/suppliers/${id}/block`, { method: "PATCH", body: JSON.stringify({ blocked }) }, token),
  markSupplierReviewed: (token: string, id: string) =>
    request(`/admin/suppliers/${id}/review`, { method: "PATCH" }, token),
  setSupplierSubscription: (token: string, id: string, active: boolean) =>
    request(`/admin/suppliers/${id}/subscription`, { method: "PATCH", body: JSON.stringify({ active }) }, token),
  listOrders: (token: string, params: { status?: string; queue?: string } = {}) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<any[]>(`/admin/orders${qs ? `?${qs}` : ""}`, {}, token);
  },
  redispatch: (token: string, id: string) =>
    request(`/admin/orders/${id}/redispatch`, { method: "POST" }, token),
  adminCancelOrder: (token: string, id: string, reason?: string) =>
    request(`/admin/orders/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }, token),
  getDispatchSettings: (token: string) => request<any>("/admin/dispatch-settings", {}, token),
  updateDispatchSettings: (token: string, body: unknown) =>
    request("/admin/dispatch-settings", { method: "PATCH", body: JSON.stringify(body) }, token),
};

export const analyticsApi = {
  track: (eventType: string, opts: { orderId?: string; metadata?: Record<string, unknown> } = {}) =>
    request("/analytics/events", { method: "POST", body: JSON.stringify({ eventType, ...opts }) }).catch(() => {
      // analytics is best-effort — never block the UI on it
    }),
};

export { ApiError, API_URL };
