"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthResult, ordersApi } from "@/lib/api";
import { getToken, setToken } from "@/lib/auth";
import { Button, Card, Spinner, StatusBadge } from "@/components/ui";
import { PhoneConfirm } from "@/components/phone-confirm";

type OrderSummary = Awaited<ReturnType<typeof ordersApi.listMine>>[number];

export default function AccountPage() {
  const router = useRouter();
  const [token, setTokenState] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setTokenState(getToken("client"));
  }, []);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    ordersApi
      .listMine(token)
      .then(setOrders)
      .finally(() => setLoading(false));
  }, [token]);

  const onAuthenticated = (auth: AuthResult) => {
    setToken("client", auth.token);
    setTokenState(auth.token);
  };

  const repeat = async (orderId: string) => {
    if (!token) return;
    setBusyId(orderId);
    try {
      const created = await ordersApi.repeat(orderId, token);
      router.push(`/orders/${created.id}`);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  };

  if (!token) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
        <h1 className="mb-4 text-center text-lg font-semibold">Вход по номеру телефона</h1>
        <Card className="p-4">
          <PhoneConfirm purpose="CLIENT_LOGIN" onAuthenticated={onAuthenticated} />
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-8">
      <h1 className="mb-4 text-lg font-semibold">Мои заявки</h1>
      {loading && <Spinner />}
      <div className="flex flex-col gap-3">
        {orders.map((o) => (
          <Card key={o.id} className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">
                №{o.number} · {o.categoryName ?? "Без категории"}
              </p>
              <p className="text-sm text-slate-500">
                {new Date(o.createdAt).toLocaleDateString("ru-RU")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge label={o.statusLabel} status={o.status} />
              {o.status === "COMPLETED" && (
                <Button variant="secondary" onClick={() => repeat(o.id)} disabled={busyId === o.id}>
                  Повторить
                </Button>
              )}
              <Button variant="ghost" onClick={() => router.push(`/orders/${o.id}`)}>
                Открыть
              </Button>
            </div>
          </Card>
        ))}
        {!loading && orders.length === 0 && <p className="text-sm text-slate-400">Заявок пока нет</p>}
      </div>
    </main>
  );
}
