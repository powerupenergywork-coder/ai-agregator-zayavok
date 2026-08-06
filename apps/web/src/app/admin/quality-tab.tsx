"use client";

import { useEffect, useState } from "react";
import { adminApi, ConversationDto, InsightsDto } from "@/lib/api";
import { Button, Card, Spinner } from "@/components/ui";

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins} мин`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} ч` : `${Math.round(hours / 24)} дн`;
}

/**
 * «Качество» — где буксуют живые люди.
 *
 * Порядок блоков не случаен: сверху воронка (сколько вообще доходит до конца),
 * под ней конкретные застрявшие заявки, дальше недоставленное и непонятые
 * фразы. Первое отвечает на вопрос «насколько всё плохо», остальное — «с чем
 * именно идти работать сегодня».
 */
export function QualityTab({ token }: { token: string }) {
  const [data, setData] = useState<InsightsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [conv, setConv] = useState<ConversationDto | null>(null);
  const [convLoading, setConvLoading] = useState(false);

  useEffect(() => {
    adminApi
      .getInsights(token)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const openConversation = (p: string) => {
    if (!p) return;
    setPhone(p);
    setConvLoading(true);
    setConv(null);
    adminApi
      .getConversation(token, p)
      .then(setConv)
      .catch((e) => setError(e.message))
      .finally(() => setConvLoading(false));
  };

  if (loading) return <Spinner />;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return null;

  const f = data.funnel;
  const steps = [
    { label: "Создано заявок", value: f.total },
    { label: "Определена категория", value: f.withCategory },
    { label: "Дошли до подтверждения", value: f.reachedConfirm },
    { label: "Опубликованы", value: f.published },
    { label: "Завершены", value: f.completed },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="mb-3 font-semibold">Воронка</h2>
        <div className="space-y-2">
          {steps.map((s) => {
            const pct = f.total > 0 ? Math.round((s.value / f.total) * 100) : 0;
            return (
              <div key={s.label} className="flex items-center gap-3 text-sm">
                <div className="w-52 shrink-0 text-slate-600">{s.label}</div>
                <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                  <div className="h-full bg-brand-600" style={{ width: `${pct}%` }} />
                </div>
                <div className="w-24 shrink-0 text-right tabular-nums">
                  {s.value} <span className="text-slate-400">({pct}%)</span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Отменено: {f.cancelled} · Без подходящих поставщиков: {f.noSuppliers}
        </p>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Откуда приходят</h2>
        <p className="mb-3 text-xs text-slate-500">
          Канал, который гонит брошенные черновики, и канал, который приносит настоящие заказы, — разные вещи,
          поэтому обе колонки рядом. Источник фиксируется один раз, при создании заявки.
        </p>
        {data.sources.length === 0 ? (
          <p className="text-sm text-slate-500">Пока нет данных.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-1">Источник</th>
                <th className="pb-1 text-right">Заявок</th>
                <th className="pb-1 text-right">Дошли до рассылки</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.map((s) => (
                <tr key={s.source} className="border-t border-slate-100">
                  <td className="py-1">{s.source}</td>
                  <td className="py-1 text-right tabular-nums">{s.orders}</td>
                  <td className="py-1 text-right tabular-nums">{s.published}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Застряли</h2>
        <p className="mb-3 text-xs text-slate-500">
          Не всякая пауза — поломка: человек мог просто отвлечься. Смотреть стоит на повторяющиеся места.
        </p>
        <StuckList
          title="Бросили на заполнении (больше 30 мин)"
          rows={data.stuck.clarifying.map((o) => ({ id: o.id, number: o.number, city: o.city, at: o.createdAt }))}
        />
        <StuckList
          title="Не нажали «Подтвердить» (больше часа)"
          rows={data.stuck.awaitingConfirm.map((o) => ({ id: o.id, number: o.number, city: o.city, at: o.createdAt }))}
        />
        <StuckList
          title="Разосланы, но ничем не закончились (больше суток)"
          rows={data.stuck.publishedNoResult.map((o) => ({
            id: o.id,
            number: o.number,
            city: o.city,
            at: o.publishedAt,
          }))}
        />
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Не доставлено за неделю</h2>
        <p className="mb-3 text-xs text-slate-500">
          Отказ WhatsApp приходит уже после отправки — раньше он был виден только в логах сервера.
        </p>
        {data.failedDelivery.length === 0 ? (
          <p className="text-sm text-slate-500">Всё дошло.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.failedDelivery.map((n) => (
              <li key={n.id} className="flex flex-wrap gap-2">
                <button className="text-brand-600 underline" onClick={() => openConversation(n.recipientPhone ?? "")}>
                  {n.recipientPhone}
                </button>
                <span className="text-slate-500">{n.templateKey}</span>
                <span className="text-red-600">{n.errorMessage}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">Бот не понял</h2>
        <p className="mb-3 text-xs text-slate-500">
          Реальные формулировки, на которые мы отвечаем отпиской. Это и есть список того, что стоит начать понимать.
        </p>
        {data.unrecognized.length === 0 ? (
          <p className="text-sm text-slate-500">Пока таких сообщений нет.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.unrecognized.map((m) => (
              <li key={m.id} className="flex flex-wrap gap-2">
                <button className="text-brand-600 underline" onClick={() => openConversation(m.phone)}>
                  {m.phone}
                </button>
                <span>«{m.text}»</span>
                <span className="text-slate-400">{ago(m.createdAt)} назад</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Переписка по номеру</h2>
        <div className="mb-3 flex gap-2">
          <input
            className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="+7 700 000 00 00"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Button onClick={() => openConversation(phone)} disabled={!phone || convLoading}>
            Показать
          </Button>
        </div>
        {convLoading && <Spinner />}
        {conv && conv.timeline.length === 0 && <p className="text-sm text-slate-500">Переписки нет.</p>}
        {conv && conv.timeline.length > 0 && (
          <ol className="space-y-2 text-sm">
            {conv.timeline.map((e, i) => (
              <li
                key={i}
                className={`rounded border px-3 py-2 ${
                  e.type === "in"
                    ? "border-slate-200 bg-white"
                    : e.type === "out"
                      ? "border-brand-200 bg-brand-50"
                      : "border-slate-100 bg-slate-50 text-slate-500"
                }`}
              >
                <div className="mb-1 flex flex-wrap gap-2 text-xs text-slate-400">
                  <span>{new Date(e.at).toLocaleString("ru-RU")}</span>
                  <span>{e.type === "in" ? "он" : e.type === "out" ? "мы" : "доставка"}</span>
                  <span>{e.kind}</span>
                  {e.unrecognized && <span className="text-amber-600">не понято</span>}
                </div>
                <div className="whitespace-pre-wrap">{e.text}</div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function StuckList({ title, rows }: { title: string; rows: { id: string; number: number; city: string | null; at: string }[] }) {
  return (
    <div className="mb-4">
      <h3 className="mb-1 text-sm font-medium">
        {title} — {rows.length}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Пусто.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.slice(0, 15).map((o) => (
            <li key={o.id} className="flex gap-3">
              <span className="font-medium">№{o.number}</span>
              <span className="text-slate-500">{o.city ?? "город не указан"}</span>
              <span className="text-slate-400">{ago(o.at)} назад</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
