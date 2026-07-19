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
import { Button, Card, Chip, Spinner, StatusBadge } from "@/components/ui";
import { FieldInput } from "@/components/field-input";
import { PhoneConfirm } from "@/components/phone-confirm";
import { CANCEL_REASON_OPTIONS } from "@/lib/reasons";

const DRAFT_STATUSES = ["DRAFT", "CLARIFYING"];

export default function OrderPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;

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
  const [cancelReason, setCancelReason] = useState(CANCEL_REASON_OPTIONS[0].value);
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
      <main className="flex min-h-screen items-center justify-center text-slate-500">Заявка не найдена</main>
    );
  }

  const sendChat = async () => {
    if (!chatText.trim() || busy) return;
    setBusy(true);
    try {
      const res = await ordersApi.chat(orderId, chatText.trim());
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
      applyTurn(await ordersApi.pickCategory(orderId, slug));
    } finally {
      setBusy(false);
    }
  };

  const setField = async (key: string, value: unknown) => {
    setBusy(true);
    try {
      applyTurn(await ordersApi.setField(orderId, key, value));
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
        <h1 className="text-lg font-semibold">Заявка №{order.number}</h1>
        <StatusBadge label={order.statusLabel} status={order.status} />
      </div>

      {isDraftPhase && !isReadyForReview && (
        <Card className="p-4">
          <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${order.progressPercent}%` }} />
          </div>
          <p className="mb-3 text-xs text-slate-500">Заявка заполнена на {order.progressPercent}%</p>

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
                  {c.name}
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
                  placeholder="Напишите ответ..."
                  className="flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm outline-none focus:border-brand-500"
                />
                <Button type="submit" disabled={busy || !chatText.trim()}>
                  Ок
                </Button>
              </form>
            )}
            <label className="cursor-pointer rounded-full border border-slate-300 px-3 py-2 text-sm">
              📷
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onPhoto(e.target.files[0])}
              />
            </label>
          </div>
        </Card>
      )}

      {isDraftPhase && isReadyForReview && !showPhoneConfirm && (
        <Card className="p-4">
          <h2 className="mb-3 text-base font-medium">Проверьте заявку</h2>
          <dl className="flex flex-col gap-2 text-sm">
            {order.category?.fields.map((f) => {
              const value = order.fieldsData[f.key];
              if (value === undefined) return null;
              return (
                <div key={f.key} className="flex items-center justify-between gap-3 border-b border-slate-50 pb-2">
                  <dt className="text-slate-500">{f.label}</dt>
                  {editingKey === f.key ? (
                    <FieldInput field={f} onSubmit={(v) => setField(f.key, v)} />
                  ) : (
                    <button className="font-medium text-slate-900 underline decoration-dotted" onClick={() => setEditingKey(f.key)}>
                      {formatValue(value, f)}
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
              Редактировать в чате
            </Button>
            <Button className="flex-1" onClick={() => setShowPhoneConfirm(true)}>
              Отправить заявку
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
            <p>Категория: {order.category?.name}</p>
            {order.city && <p>Город: {order.city}</p>}
            {order.dateNeeded && <p>Дата: {new Date(order.dateNeeded).toLocaleDateString("ru-RU")}</p>}
            <p className="mt-2 text-xs text-slate-400">Обновляется автоматически, перезагружать страницу не нужно.</p>
          </Card>

          {order.status === "PUBLISHED" && (
            <Card className="p-4 text-sm">
              <h2 className="mb-1 text-base font-medium">Разослано поставщикам</h2>
              <p className="text-slate-600">
                {order.notifiedSuppliersCount > 0
                  ? `Уведомили ${order.notifiedSuppliersCount} поставщиков — они видят ваш телефон и свяжутся напрямую. Ожидайте звонков.`
                  : "Ищем подходящих поставщиков для вашей заявки."}
              </p>
            </Card>
          )}

          {order.status === "AWAITING_PHONE_CONFIRMATION" && (
            <Card className="p-4 text-sm text-slate-600">
              <p>
                Мы отправили описание заявки в WhatsApp{order.clientPhone ? ` на ${order.clientPhone}` : ""} —
                нажмите там кнопку «Подтвердить», чтобы опубликовать заявку и начать поиск исполнителей.
              </p>
              <p className="mt-2 text-xs text-slate-400">Эта страница обновится сама, перезагружать не нужно.</p>
            </Card>
          )}

          {order.status === "NEEDS_OPERATOR" && (
            <Card className="p-4 text-sm text-slate-600">
              Заявка передана оператору — мы разбираемся и скоро свяжемся с вами.
            </Card>
          )}

          {order.status === "PUBLISHED" && !showComplete && (
            <Button onClick={() => setShowComplete(true)} className="self-start">
              Услугу оказали
            </Button>
          )}

          {showComplete && (
            <Card className="p-4">
              <p className="mb-3 text-sm font-medium">Всё прошло хорошо?</p>
              <div className="flex gap-2">
                <Button onClick={() => complete(true)} disabled={busy}>Да, всё хорошо</Button>
                <Button variant="ghost" onClick={() => complete(false)} disabled={busy}>Нет, не получилось</Button>
              </div>
            </Card>
          )}

          {!["COMPLETED", "CANCELLED_BY_CLIENT", "CANCELLED_BY_ADMIN"].includes(order.status) && (
            <Button variant="ghost" onClick={() => setShowCancel(true)} className="self-start">
              Отменить заявку
            </Button>
          )}
        </div>
      )}

      {showCancel && (
        <Modal onClose={() => setShowCancel(false)}>
          <h3 className="mb-3 text-base font-medium">Почему вы отменяете заявку?</h3>
          <select value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="mb-4 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
            {CANCEL_REASON_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setShowCancel(false)}>Назад</Button>
            <Button variant="danger" className="flex-1" onClick={cancelOrder} disabled={busy}>Отменить заявку</Button>
          </div>
        </Modal>
      )}
    </main>
  );
}

function formatValue(value: unknown, field: CategoryField): string {
  if (value === "unknown") return "не знаю";
  if (value === "approximate") return "примерно";
  if (value === "needs_consultation") return "нужна консультация";
  if (field.type === "boolean") return value ? "да" : "нет";
  if (field.type === "enum") return field.options?.find((o) => o.value === value)?.label ?? String(value);
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
