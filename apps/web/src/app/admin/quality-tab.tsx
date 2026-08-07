"use client";

import { useEffect, useState } from "react";
import { adminApi, ConversationDto, InsightsDto } from "@/lib/api";
import { Button, Card, Spinner } from "@/components/ui";
import { OrderDetails } from "./order-details";

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

      <SupplierFunnel data={data.supplierFunnel} onOpenConversation={openConversation} />

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
          token={token}
          title="Бросили на заполнении (больше 30 мин)"
          rows={data.stuck.clarifying.map((o) => ({
            id: o.id,
            number: o.number,
            city: o.city,
            at: o.createdAt,
            lastQuestion: o.lastQuestion,
            lastAnswer: o.lastAnswer,
          }))}
        />
        <StuckList
          token={token}
          title="Не нажали «Подтвердить» (больше часа)"
          rows={data.stuck.awaitingConfirm.map((o) => ({
            id: o.id,
            number: o.number,
            city: o.city,
            at: o.createdAt,
            lastQuestion: o.lastQuestion,
            lastAnswer: o.lastAnswer,
          }))}
        />
        <StuckList
          token={token}
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
          <FailureGroups rows={data.failedDelivery} onPhone={openConversation} />
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

/**
 * Что стало с холодным приглашением. Воронка по заявкам показывает только
 * сторону клиента, а половина потерь живёт на стороне исполнителя.
 *
 * Проценты считаем от отправленных, а не от базы: интересно, куда делись те,
 * кому мы написали, а не какую долю справочника успели обработать.
 */
function SupplierFunnel({
  data,
  onOpenConversation,
}: {
  data: {
    inBase: number;
    invited: number;
    delivered: number;
    read: number;
    failed: number;
    confirmed: number;
    declined: number;
    silent: number;
    exhausted: number;
    maxAttempts: number;
    wroteText: {
      id: string;
      phone: string;
      companyName: string | null;
      confirmed: boolean;
      text: string | null;
      at: string;
      selfDescription: string | null;
    }[];
  };
  onOpenConversation: (phone: string) => void;
}) {
  const steps = [
    { label: "Отправили приглашение", value: data.invited },
    { label: "Доставлено", value: data.delivered },
    { label: "Прочитано", value: data.read },
    { label: "Согласились получать заявки", value: data.confirmed },
  ];

  return (
    <Card>
      <h2 className="mb-1 font-semibold">Поставщики: что стало с приглашением</h2>
      <p className="mb-3 text-xs text-slate-500">
        Проценты — от числа отправленных приглашений. Всего в базе: {data.inBase}.
      </p>
      <div className="space-y-2">
        {steps.map((s) => {
          const pct = data.invited > 0 ? Math.round((s.value / data.invited) * 100) : 0;
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
        Отказались («не писать мне»): {data.declined} · Не доставлено: {data.failed} · Молчат после доставки:{" "}
        {data.silent}
      </p>
      {/* Тем, кто исчерпал попытки, приглашения больше не уходят вообще —
          без этой строки они просто пропадают из рассылки без объяснения. */}
      <p className="mt-1 text-xs text-slate-500">
        Больше не пишем ({data.maxAttempts} приглашения без ответа): {data.exhausted}
      </p>

      <h3 className="mb-1 mt-5 text-sm font-medium">Написали текстом, а не кнопкой — {data.wroteText.length}</h3>
      <p className="mb-2 text-xs text-slate-500">
        Это не статистика, а список людей, которым нужен живой ответ. Переписка хранится 7 дней, поэтому здесь
        только последняя неделя.
      </p>
      {data.wroteText.length === 0 ? (
        <p className="text-sm text-slate-500">Пусто.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {data.wroteText.map((s) => (
            <li key={s.id} className="rounded border border-slate-100 px-2 py-1.5">
              <button className="w-full text-left" onClick={() => onOpenConversation(s.phone)}>
                <span className="font-medium">{s.companyName ?? "без названия"}</span>
                <span className="ml-2 text-slate-500">{s.phone}</span>
                <span className={`ml-2 text-xs ${s.confirmed ? "text-emerald-700" : "text-amber-700"}`}>
                  {s.confirmed ? "согласился" : "не подтвердил"}
                </span>
                <span className="ml-2 text-slate-400">{ago(s.at)} назад</span>
                {s.text && <div className="mt-0.5 text-xs text-slate-600">«{s.text.slice(0, 120)}»</div>}
                {s.selfDescription && (
                  <div className="mt-0.5 text-xs text-sky-700">о себе: {s.selfDescription.slice(-120)}</div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function StuckList({
  token,
  title,
  rows,
}: {
  token: string;
  title: string;
  rows: {
    id: string;
    number: number;
    city: string | null;
    at: string;
    lastQuestion?: string | null;
    lastAnswer?: string | null;
  }[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="mb-5">
      <h3 className="mb-1 text-sm font-medium">
        {title} — {rows.length}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Пусто.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.slice(0, 15).map((o) => (
            <li key={o.id} className="rounded border border-slate-100 px-2 py-1.5">
              <button className="w-full text-left" onClick={() => setOpenId(openId === o.id ? null : o.id)}>
                <span className="mr-1 text-slate-400">{openId === o.id ? "\u25be" : "\u25b8"}</span>
                <span className="font-medium">№{o.number}</span>
                <span className="ml-2 text-slate-500">{o.city ?? "город не указан"}</span>
                <span className="ml-2 text-slate-400">{ago(o.at)} назад</span>
                {o.lastQuestion && (
                  <div className="mt-0.5 text-xs text-slate-500">
                    бот спросил: «{o.lastQuestion.slice(0, 90)}»
                    {o.lastAnswer ? ` · ответ: «${o.lastAnswer.slice(0, 60)}»` : ""}
                  </div>
                )}
              </button>
              {openId === o.id && <OrderDetails token={token} orderId={o.id} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const FAILURE_HINTS: Record<string, string> = {
  "131047": "окно 24 часа закрыто — свободный текст не проходит, нужен утверждённый шаблон",
  "131026": "на номере нет WhatsApp",
  "131030": "номера нет в списке разрешённых (тестовый номер)",
  "132018": "недопустимый параметр шаблона",
};

/**
 * Одинаковые отказы схлопываются в одну строку с количеством.
 *
 * Тридцать подряд «131047 — Re-engagement message» читать невозможно, а
 * решение по ним одно на всех. Разворачивается, когда нужны конкретные номера.
 */
function FailureGroups({
  rows,
  onPhone,
}: {
  rows: { id: string; templateKey: string; recipientPhone: string | null; errorMessage: string | null }[];
  onPhone: (phone: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const groups = new Map<string, { phones: string[]; templates: Set<string> }>();
  for (const r of rows) {
    // Код ошибки — устойчивый ключ: текст Меты вокруг него меняется.
    const code = r.errorMessage?.match(/\b1[0-9]{5}\b/)?.[0] ?? (r.errorMessage ?? "без пояснения").slice(0, 40);
    const g = groups.get(code) ?? { phones: [], templates: new Set<string>() };
    if (r.recipientPhone) g.phones.push(r.recipientPhone);
    g.templates.add(r.templateKey);
    groups.set(code, g);
  }

  return (
    <ul className="space-y-2 text-sm">
      {[...groups.entries()]
        .sort((a, b) => b[1].phones.length - a[1].phones.length)
        .map(([code, g]) => (
          <li key={code} className="rounded border border-slate-100 px-2 py-1.5">
            <button className="w-full text-left" onClick={() => setOpen(open === code ? null : code)}>
              <span className="mr-1 text-slate-400">{open === code ? "\u25be" : "\u25b8"}</span>
              <span className="font-medium text-red-600">{code}</span>
              <span className="ml-2">— {g.phones.length} шт.</span>
              <span className="ml-2 text-slate-500">{[...g.templates].join(", ")}</span>
              {FAILURE_HINTS[code] && <div className="mt-0.5 text-xs text-slate-500">{FAILURE_HINTS[code]}</div>}
            </button>
            {open === code && (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {g.phones.map((p, i) => (
                  <button key={`${p}-${i}`} className="text-brand-600 underline" onClick={() => onPhone(p)}>
                    {p}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
    </ul>
  );
}
