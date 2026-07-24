"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { CategoryField } from "@ai-zayavki/shared";
import {
  ChatTurnResponse,
  CategorySummary,
  OrderDto,
  ordersApi,
  categoriesApi,
  analyticsApi,
  AuthResult,
} from "@/lib/api";
import { getToken } from "@/lib/auth";
import { watchOrder } from "@/lib/socket";
import { useLocale } from "@/lib/i18n/context";
import { Button, Card, Chip, Spinner, StatusBadge } from "@/components/ui";
import { FieldInput } from "@/components/field-input";
import { PhoneConfirm } from "@/components/phone-confirm";
import { CANCEL_REASON_VALUES } from "@/lib/reasons";
import type { Dictionary } from "@/lib/i18n/dictionaries/ru";

const DRAFT_STATUSES = ["DRAFT", "CLARIFYING"];

export default function OrderPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const { locale, t } = useLocale();

  const [order, setOrder] = useState<OrderDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [chatText, setChatText] = useState("");
  const [needsCategoryPick, setNeedsCategoryPick] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState<CategorySummary[]>([]);
  const [nextFields, setNextFields] = useState<CategoryField[]>([]);
  const [isReadyForReview, setIsReadyForReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPhoneConfirm, setShowPhoneConfirm] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState<string>(CANCEL_REASON_VALUES[0]);
  const [showComplete, setShowComplete] = useState(false);

  const clientToken = getToken("client");

  const applyTurn = (res: ChatTurnResponse) => {
    setOrder(res.order);
    setNeedsCategoryPick(res.needsCategoryPick);
    setCategoryOptions(res.categories ?? []);
    setNextFields(res.nextFields);
    setIsReadyForReview(res.isReadyForReview);
  };

  useEffect(() => {
    ordersApi
      .get(orderId)
      .then((o) => {
        setOrder(o);
        setNextFields(o.nextFields);
        setNeedsCategoryPick(o.needsCategoryPick);
        setIsReadyForReview(!!o.category && o.nextFields.length === 0 && o.progressPercent >= 100);
        if (o.needsCategoryPick) categoriesApi.listActive().then(setCategoryOptions).catch(() => {});
      })
      .finally(() => setLoading(false));
  }, [orderId]);

  useEffect(() => {
    const unwatch = watchOrder(orderId, { onOrderUpdated: (payload: OrderDto) => setOrder(payload) });
    return unwatch;
  }, [orderId]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner />
      </main>
    );
  }
  if (!order) {
    return (
      <main className="flex min-h-screen items-center justify-center text-slate-500">{t.common.orderNotFound}</main>
    );
  }

  const sendChat = async () => {
    if (!chatText.trim() || busy) return;
    setBusy(true);
    try {
      const res = await ordersApi.chat(orderId, chatText.trim(), locale);
      applyTurn(res);
      setChatText("");
      analyticsApi.track("first_message_sent", { orderId });
    } finally {
      setBusy(false);
    }
  };

  const pickCategory = async (slug: string) => {
    setBusy(true);
    try {
      applyTurn(await ordersApi.pickCategory(orderId, slug, locale));
    } finally {
      setBusy(false);
    }
  };

  const setField = async (key: string, value: unknown) => {
    setBusy(true);
    try {
      applyTurn(await ordersApi.setField(orderId, key, value, locale));
      setEditingKey(null);
    } finally {
      setBusy(false);
    }
  };

  const onPhoto = async (file: File) => {
    setBusy(true);
    try {
      const updated = await ordersApi.uploadPhoto(orderId, file);
      setOrder(updated);
    } finally {
      setBusy(false);
    }
  };

  const publish = async (auth: AuthResult) => {
    setBusy(true);
    try {
      const published = await ordersApi.publish(orderId, auth.token);
      setOrder(published);
      setShowPhoneConfirm(false);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelOrder = async () => {
    if (!clientToken) return;
    setBusy(true);
    try {
      const updated = await ordersApi.cancel(orderId, clientToken, cancelReason);
      setOrder(updated);
      setShowCancel(false);
    } finally {
      setBusy(false);
    }
  };

  const complete = async (positive: boolean) => {
    if (!clientToken) return;
    setBusy(true);
    try {
      const updated = await ordersApi.complete(orderId, clientToken, positive);
      setOrder(updated);
      setShowComplete(false);
    } finally {
      setBusy(false);
    }
  };

  const isDraftPhase = DRAFT_STATUSES.includes(order.status);

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t.order.title(order.number)}</h1>
        <StatusBadge label={order.statusLabel[locale]} status={order.status} />
      </div>

      {isDraftPhase && !isReadyForReview && (
        <Card className="p-4">
          <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${order.progressPercent}%` }} />
          </div>
          <p className="mb-3 text-xs text-slate-500">{t.order.filledPercent(order.progressPercent)}</p>

          <div className="flex flex-col gap-3">
            {order.chatMessages.map((m, i) => (
              <div key={i} className={m.role === "USER" ? "self-end rounded-2xl rounded-br-sm bg-brand-600 px-4 py-2 text-sm text-white" : "self-start rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2 text-sm text-slate-800"}>
                {m.content}
              </div>
            ))}
          </div>

          {needsCategoryPick && (
            <div className="mt-3 flex flex-wrap gap-2">
              {categoryOptions.map((c) => (
                <Chip key={c.slug} onClick={() => pickCategory(c.slug)} disabled={busy}>
                  {c.name[locale]}
                </Chip>
              ))}
            </div>
          )}

          {!needsCategoryPick && nextFields.length > 0 && (
            <div className="mt-3 flex flex-col gap-3">
              {nextFields.map((f) => (
                <FieldInput key={f.key} field={f} onSubmit={(v) => setField(f.key, v)} />
              ))}
            </div>
          )}

          <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
            {/* While a specific field question is on screen (FieldInput above),
                a second free-text box right under it reads as a confusing
                duplicate — only show general chat when nothing structured is
                pending (picking a category, or the very first message). */}
            {nextFields.length === 0 && (
              <form
                className="flex flex-1 gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendChat();
                }}
              >
                <input
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  placeholder={t.order.typeAnswer}
                  className="flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm outline-none focus:border-brand-500"
                />
                <Button type="submit" disabled={busy || !chatText.trim()}>
                  {t.common.ok}
                </Button>
              </form>
            )}
            <label className="cursor-pointer rounded-full border border-slate-300 px-3 py-2 text-sm">
              {t.order.photo}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onPhoto(e.target.files[0])}
              />
            </label>
          </div>
          {order.photos.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto">
              {order.photos.map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={url} src={url} alt="" className="h-16 w-16 rounded-lg object-cover" />
              ))}
            </div>
          )}
        </Card>
      )}

      {isDraftPhase && isReadyForReview && !showPhoneConfirm && (
        <Card className="p-4">
          <h2 className="mb-3 text-base font-medium">{t.order.reviewTitle}</h2>
          <dl className="flex flex-col gap-2 text-sm">
            {order.category?.fields.map((f) => {
              const value = order.fieldsData[f.key];
              if (value === undefined) return null;
              return (
                <div key={f.key} className="flex items-center justify-between gap-3 border-b border-slate-50 pb-2">
                  <dt className="text-slate-500">{f.label[locale]}</dt>
                  {editingKey === f.key ? (
                    <FieldInput field={f} onSubmit={(v) => setField(f.key, v)} />
                  ) : (
                    <button className="font-medium text-slate-900 underline decoration-dotted" onClick={() => setEditingKey(f.key)}>
                      {formatValue(value, f, locale, t)}
                    </button>
                  )}
                </div>
              );
            })}
          </dl>
          {order.photos.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto">
              {order.photos.map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={url} src={url} alt="" className="h-20 w-20 rounded-lg object-cover" />
              ))}
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <Button variant="ghost" onClick={() => setIsReadyForReview(false)}>
              {t.order.editInChat}
            </Button>
            <Button className="flex-1" onClick={() => setShowPhoneConfirm(true)}>
              {t.order.submitOrder}
            </Button>
          </div>
        </Card>
      )}

      {isDraftPhase && isReadyForReview && showPhoneConfirm && (
        <Card className="p-4">
          <PhoneConfirm purpose="CLIENT_LOGIN" onAuthenticated={publish} onCancel={() => setShowPhoneConfirm(false)} />
        </Card>
      )}

      {!isDraftPhase && (
        <div className="flex flex-col gap-4">
          <Card className="p-4 text-sm text-slate-600">
            <p>
              {t.order.category}: {order.category?.name[locale]}
            </p>
            {order.city && (
              <p>
                {t.order.city}: {order.city}
              </p>
            )}
            {order.dateNeeded && (
              <p>
                {t.order.date}: {new Date(order.dateNeeded).toLocaleDateString(locale === "kk" ? "kk-KZ" : "ru-RU")}
              </p>
            )}
            <p className="mt-2 text-xs text-slate-400">{t.order.autoRefreshHintShort}</p>
          </Card>

          {order.status === "PUBLISHED" && (
            <Card className="p-4 text-sm">
              <h2 className="mb-1 text-base font-medium">{t.order.publishedTitle}</h2>
              <p className="text-slate-600">
                {order.notifiedSuppliersCount > 0
                  ? t.order.publishedWithCount(order.notifiedSuppliersCount)
                  : t.order.publishedNoCount}
              </p>
            </Card>
          )}

          {order.status === "AWAITING_PHONE_CONFIRMATION" && (
            <Card className="p-4 text-sm text-slate-600">
              <p>{t.order.awaitingConfirmationText(order.clientPhone)}</p>
              <p className="mt-2 text-xs text-slate-400">{t.order.autoRefreshHint}</p>
            </Card>
          )}

          {order.status === "NEEDS_OPERATOR" && (
            <Card className="p-4 text-sm text-slate-600">{t.order.needsOperator}</Card>
          )}

          {order.status === "PUBLISHED" && !showComplete && (
            <Button onClick={() => setShowComplete(true)} className="self-start">
              {t.order.serviceProvided}
            </Button>
          )}

          {showComplete && (
            <Card className="p-4">
              <p className="mb-3 text-sm font-medium">{t.order.allGoodQuestion}</p>
              <div className="flex gap-2">
                <Button onClick={() => complete(true)} disabled={busy}>{t.order.yesAllGood}</Button>
                <Button variant="ghost" onClick={() => complete(false)} disabled={busy}>{t.order.noDidntWork}</Button>
              </div>
            </Card>
          )}

          {!["COMPLETED", "CANCELLED_BY_CLIENT", "CANCELLED_BY_ADMIN"].includes(order.status) && (
            <Button variant="ghost" onClick={() => setShowCancel(true)} className="self-start">
              {t.order.cancelOrder}
            </Button>
          )}
        </div>
      )}

      {showCancel && (
        <Modal onClose={() => setShowCancel(false)}>
          <h3 className="mb-3 text-base font-medium">{t.order.cancelReasonPrompt}</h3>
          <select value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="mb-4 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
            {CANCEL_REASON_VALUES.map((value) => (
              <option key={value} value={value}>{t.reasons[value]}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setShowCancel(false)}>{t.common.back}</Button>
            <Button variant="danger" className="flex-1" onClick={cancelOrder} disabled={busy}>{t.order.cancelOrder}</Button>
          </div>
        </Modal>
      )}
    </main>
  );
}

function formatValue(value: unknown, field: CategoryField, locale: "ru" | "kk", t: Dictionary): string {
  if (value === "unknown") return t.fieldValue.unknown;
  if (value === "approximate") return t.fieldValue.approximate;
  if (value === "needs_consultation") return t.fieldValue.needsConsultation;
  if (field.type === "boolean") return value ? t.fieldValue.yes : t.fieldValue.no;
  if (field.type === "enum") return field.options?.find((o) => o.value === value)?.label[locale] ?? String(value);
  return `${value}${field.unit ? ` ${field.unit}` : ""}`;
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
