"use client";

import { useEffect, useState } from "react";
import { adminApi, OrderDetailsDto } from "@/lib/api";
import { Spinner } from "@/components/ui";

const dt = (iso: string) => new Date(iso).toLocaleString("ru-RU");

/**
 * Содержание заявки под строкой списка.
 *
 * Список показывает только шапку, и по ней нельзя понять, что человек просил.
 * Здесь то, что нужно, чтобы разобрать жалобу не заглядывая в базу: поля с
 * человеческими названиями, переписка целиком и что реально ушло поставщикам.
 *
 * Грузится по требованию, а не вместе со списком: заявок в списке до двухсот,
 * а открывают обычно одну.
 */
export function OrderDetails({ token, orderId }: { token: string; orderId: string }) {
  const [data, setData] = useState<OrderDetailsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .getOrderDetails(token, orderId)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [token, orderId]);

  if (error) return <p className="mt-3 text-sm text-red-600">{error}</p>;
  if (!data) return <div className="mt-3"><Spinner /></div>;

  const when = [data.dateNeeded ? new Date(data.dateNeeded).toLocaleDateString("ru-RU") : null, data.timeWindow]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="mt-3 space-y-4 border-t border-slate-200 pt-3 text-sm">
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <Row label="Создана" value={dt(data.createdAt)} />
        {data.publishedAt && <Row label="Разослана" value={dt(data.publishedAt)} />}
        {when && <Row label="Когда нужно" value={when} />}
        {data.urgent && <Row label="Срочность" value="срочная" />}
        {data.addressFrom && <Row label="Адрес" value={data.addressFrom} />}
        {data.addressTo && <Row label="Куда" value={data.addressTo} />}
        <Row label="Телефон клиента" value={data.clientPhone ?? "не подтверждён"} />
        <Row label="Источник" value={data.source ?? "—"} />
        <Row label="Уведомлено поставщиков" value={String(data.notifiedSuppliersCount)} />
        {data.cancelReason && <Row label="Причина отмены" value={data.cancelReason} />}
      </div>

      <Section title="Что просили">
        {data.fields.length === 0 ? (
          <p className="text-slate-500">Поля не заполнены — человек ушёл на первом шаге.</p>
        ) : (
          <ul className="space-y-0.5">
            {data.fields.map((f) => (
              <li key={f.label}>
                <span className="text-slate-500">{f.label}:</span> {f.value}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {data.photos.length > 0 && (
        <Section title="Фотографии">
          <div className="flex flex-wrap gap-2">
            {data.photos.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer">
                <img src={url} alt="" className="h-20 w-20 rounded object-cover" />
              </a>
            ))}
          </div>
        </Section>
      )}

      <Section title="Диалог">
        {data.chat.length === 0 ? (
          <p className="text-slate-500">Переписки нет.</p>
        ) : (
          <ol className="space-y-1">
            {data.chat.map((m, i) => (
              <li key={i} className={m.role === "USER" ? "text-slate-900" : "text-slate-600"}>
                <span className="text-xs text-slate-400">{m.role === "USER" ? "клиент" : "бот"} · {dt(m.at)}</span>
                <div className="whitespace-pre-wrap">{m.content}</div>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {data.notifications.length > 0 && (
        <Section title="Что ушло">
          <ul className="space-y-0.5">
            {data.notifications.map((n) => (
              <li key={n.id} className="flex flex-wrap gap-2">
                <span className="text-slate-400">{dt(n.createdAt)}</span>
                <span>{n.recipientPhone}</span>
                <span className="text-slate-500">{n.templateKey}</span>
                {n.status === "FAILED" ? (
                  <span className="text-red-600">не доставлено: {n.errorMessage}</span>
                ) : (
                  <span className="text-slate-500">{n.deliveredAt ? "доставлено" : "принято"}</span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {data.statusHistory.length > 0 && (
        <Section title="История статусов">
          <ul className="space-y-0.5 text-slate-600">
            {data.statusHistory.map((h, i) => (
              <li key={i}>
                {dt(h.at)} — {h.status}
                {h.actor ? ` (${h.actor})` : ""}
                {h.reason ? `: ${h.reason}` : ""}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-slate-500">{label}:</span> {value}
    </p>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 font-medium text-slate-900">{title}</h4>
      {children}
    </div>
  );
}
