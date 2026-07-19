"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { OrderDto, ordersApi } from "@/lib/api";
import { useLocale } from "@/lib/i18n/context";
import { Card, Spinner, StatusBadge } from "@/components/ui";

export default function SupplierOrderPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = params.orderId;
  const { locale, t } = useLocale();

  const [order, setOrder] = useState<OrderDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ordersApi
      .get(orderId)
      .then(setOrder)
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner />
      </main>
    );
  }
  if (!order) {
    return <main className="flex min-h-screen items-center justify-center text-slate-500">{t.common.orderNotFound}</main>;
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t.supplierView.orderTitle(order.number)}</h1>
        <StatusBadge label={order.statusLabel[locale]} status={order.status} />
      </div>

      <Card className="p-4">
        <p className="font-medium">{order.category?.name[locale]}</p>
        <div className="mt-2 flex flex-col gap-1 text-sm text-slate-600">
          {order.city && (
            <p>
              {t.supplierView.cityDistrict}: {order.city}
            </p>
          )}
          {order.dateNeeded && (
            <p>
              {t.supplierView.date}: {new Date(order.dateNeeded).toLocaleDateString(locale === "kk" ? "kk-KZ" : "ru-RU")} {order.timeWindow ?? ""}
            </p>
          )}
          {order.category?.fields.map((f) => {
            const v = order.fieldsData[f.key];
            if (v === undefined) return null;
            return (
              <p key={f.key}>
                {f.label[locale]}: {String(v)}
                {f.unit ? ` ${f.unit}` : ""}
              </p>
            );
          })}
        </div>
        {order.photos.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {order.photos.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt="" className="h-20 w-20 rounded-lg object-cover" />
            ))}
          </div>
        )}
      </Card>

      {order.clientPhone ? (
        <Card className="mt-4 p-4">
          <h2 className="mb-2 text-base font-medium">{t.supplierView.clientContacts}</h2>
          <p className="text-sm">
            {t.supplierView.callDirectly}{" "}
            <a href={`tel:${order.clientPhone}`} className="text-brand-600">
              {order.clientPhone}
            </a>
          </p>
        </Card>
      ) : (
        <Card className="mt-4 p-4 text-sm text-slate-500">{t.supplierView.notPublishedYet}</Card>
      )}
    </main>
  );
}
