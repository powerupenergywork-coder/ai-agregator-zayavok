"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { OrderDto, ordersApi } from "@/lib/api";
import { Button, Card, Spinner } from "@/components/ui";

export default function ConfirmPublishPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [order, setOrder] = useState<OrderDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ordersApi
      .getByToken(token)
      .then(setOrder)
      .finally(() => setLoading(false));
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await ordersApi.confirmPublishByToken(token);
      setOrder(updated);
    } catch (e: any) {
      setError(e.message || "Не получилось подтвердить заявку");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner />
      </main>
    );
  }
  if (!order) {
    return <main className="flex min-h-screen items-center justify-center text-slate-500">Заявка не найдена</main>;
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-8">
      <h1 className="mb-4 text-lg font-semibold">Заявка №{order.number}</h1>
      <Card className="p-4">
        <p className="font-medium">{order.category?.name}</p>
        <div className="mt-2 flex flex-col gap-1 text-sm text-slate-600">
          {order.city && <p>Город: {order.city}</p>}
          {order.dateNeeded && (
            <p>
              Дата: {new Date(order.dateNeeded).toLocaleDateString("ru-RU")} {order.timeWindow ?? ""}
            </p>
          )}
          {order.category?.fields.map((f) => {
            const v = order.fieldsData[f.key];
            if (v === undefined) return null;
            return (
              <p key={f.key}>
                {f.label}: {String(v)}
              </p>
            );
          })}
        </div>

        {order.status === "AWAITING_PHONE_CONFIRMATION" && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="mb-3 text-sm text-slate-600">
              Проверьте данные заявки выше и нажмите «Подтвердить», чтобы опубликовать её и начать поиск исполнителей.
            </p>
            {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
            <Button onClick={confirm} disabled={busy} className="w-full">
              Подтвердить
            </Button>
          </div>
        )}

        {order.status === "PUBLISHED" && (
          <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-green-700">
            Заявка опубликована, мы начали поиск исполнителей.
          </p>
        )}

        {!["AWAITING_PHONE_CONFIRMATION", "PUBLISHED"].includes(order.status) && (
          <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-500">
            Заявка уже в статусе «{order.statusLabel}» — подтверждение здесь больше не требуется.
          </p>
        )}
      </Card>
    </main>
  );
}
