"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthResult, ordersApi } from "@/lib/api";
import { getToken, setToken } from "@/lib/auth";
import { useLocale } from "@/lib/i18n/context";
import { Button, Card, Spinner, StatusBadge } from "@/components/ui";
import { PhoneConfirm } from "@/components/phone-confirm";

type OrderSummary = Awaited<ReturnType<typeof ordersApi.listMine>>[number];

export default function AccountPage() {
  const router = useRouter();
  const { locale, t } = useLocale();
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
        <h1 className="mb-4 text-center text-lg font-semibold">{t.account.loginHeading}</h1>
        <Card className="p-4">
          <PhoneConfirm purpose="CLIENT_LOGIN" onAuthenticated={onAuthenticated} />
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-8">
      <h1 className="mb-4 text-lg font-semibold">{t.account.myOrders}</h1>
      {loading && <Spinner />}
      <div className="flex flex-col gap-3">
        {orders.map((o) => (
          <Card key={o.id} className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">
                №{o.number} · {o.categoryName?.[locale] ?? t.account.noCategory}
              </p>
              <p className="text-sm text-slate-500">
                {new Date(o.createdAt).toLocaleDateString(locale === "kk" ? "kk-KZ" : "ru-RU")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge label={o.statusLabel[locale]} status={o.status} />
              {o.status === "COMPLETED" && (
                <Button variant="secondary" onClick={() => repeat(o.id)} disabled={busyId === o.id}>
                  {t.account.repeat}
                </Button>
              )}
              <Button variant="ghost" onClick={() => router.push(`/orders/${o.id}`)}>
                {t.account.open}
              </Button>
            </div>
          </Card>
        ))}
        {!loading && orders.length === 0 && <p className="text-sm text-slate-400">{t.account.noOrders}</p>}
      </div>
    </main>
  );
}
