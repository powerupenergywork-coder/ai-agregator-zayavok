"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import { Button, Card, Spinner } from "@/components/ui";

const FILTERS = [
  { value: "", label: "Все" },
  { value: "text", label: "Писали текстом" },
  { value: "unrecognized", label: "Бот не понял" },
  { value: "silent", label: "Молчат" },
];

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * Все переписки с людьми — вход, которого не было.
 *
 * Лента по номеру существовала и раньше, но открыть её можно было, только
 * зная номер наизусть: чтобы найти разговор, надо было сначала знать, что он
 * есть. Посмотреть, как бот вообще разговаривает с людьми, было нельзя.
 *
 * Фильтры не декоративные, а по разным вопросам к сервису: «писали текстом» —
 * кому не хватило кнопок, «бот не понял» — где он глухой, «молчат» — до кого
 * сообщение дошло и не сработало.
 */
export function ConversationsTab({ token }: { token: string }) {
  const [filter, setFilter] = useState("");
  const [data, setData] = useState<any>(null);
  const [openPhone, setOpenPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    adminApi
      .listConversations(token, filter)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [token, filter]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;

  return (
    <div>
      <div className="mb-3 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-full px-3 py-1.5 text-sm ${
              filter === f.value ? "bg-brand-600 text-white" : "border border-slate-300 bg-white text-slate-600"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!data ? (
        <Spinner />
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-500">
            Диалогов: {data.total}. Переписка хранится {data.retentionDays} дней — всё, что старше, удаляется.
          </p>
          <div className="flex flex-col gap-2">
            {data.rows.map((c: any) => (
              <div key={c.phone} className="flex flex-col gap-1">
                <Card className="p-3 text-sm">
                  <button
                    className="w-full text-left"
                    onClick={() => setOpenPhone(openPhone === c.phone ? null : c.phone)}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-medium">
                        <span className="mr-1 inline-block w-3 text-slate-400">
                          {openPhone === c.phone ? "▾" : "▸"}
                        </span>
                        {c.name ?? "неизвестный"}
                        <span className="ml-2 font-normal text-slate-500">{c.phone}</span>
                        {c.role === "supplier" && (
                          <span
                            className={`ml-2 text-xs font-normal ${
                              c.blocked ? "text-red-600" : c.confirmed ? "text-emerald-700" : "text-amber-700"
                            }`}
                          >
                            {c.blocked ? "отказался" : c.confirmed ? "согласился" : "не подтвердил"}
                          </span>
                        )}
                      </p>
                      <span className="shrink-0 text-xs text-slate-400">{when(c.lastAt)}</span>
                    </div>
                    <p className="mt-0.5 truncate pl-4 text-slate-600">
                      {/* Кто написал последним — половина ответа на «чем кончилось».
                          Бот замолчал последним или человек остался без ответа. */}
                      <span className="text-slate-400">{c.lastFrom === "human" ? "он: " : "бот: "}</span>
                      {c.lastText}
                    </p>
                    <p className="pl-4 text-xs text-slate-400">
                      от него {c.inCount} · от нас {c.outCount}
                      {c.humanTextCount > 0 && <span className="ml-2 text-sky-700">писал текстом</span>}
                      {c.unrecognizedCount > 0 && (
                        <span className="ml-2 text-amber-700">не понято: {c.unrecognizedCount}</span>
                      )}
                    </p>
                  </button>
                </Card>
                {openPhone === c.phone && <Thread token={token} phone={c.phone} />}
              </div>
            ))}
            {data.rows.length === 0 && <p className="text-sm text-slate-400">Пусто.</p>}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Лента одного разговора.
 *
 * Реплики разведены по сторонам, как в мессенджере: вопрос «что написал бот,
 * а что человек» должен читаться взглядом, а не разбором подписей. Строки
 * доставки идут отдельной серой полосой между репликами — они часть истории
 * («сообщение не дошло» объясняет молчание), но не часть разговора.
 */
function Thread({ token, phone }: { token: string; phone: string }) {
  const [conv, setConv] = useState<any>(null);

  useEffect(() => {
    setConv(null);
    adminApi.getConversation(token, phone).then(setConv).catch(() => setConv({ timeline: [] }));
  }, [token, phone]);

  if (!conv) return <p className="pl-4 text-sm text-slate-400">Загружаю…</p>;

  return (
    <Card className="ml-4 border-l-4 border-brand-200 p-3">
      <div className="flex flex-col gap-2">
        {conv.timeline.map((t: any, i: number) => {
          if (t.type === "delivery") {
            return (
              <p key={i} className="text-center text-xs text-slate-400">
                {t.kind} — {t.text}
              </p>
            );
          }
          const fromHuman = t.type === "in";
          return (
            <div key={i} className={`flex ${fromHuman ? "justify-start" : "justify-end"}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                  fromHuman
                    ? t.unrecognized
                      ? "bg-amber-50 text-amber-900"
                      : "bg-slate-100 text-slate-900"
                    : "bg-brand-50 text-slate-900"
                }`}
              >
                <p className="whitespace-pre-line">{t.text || `[${t.kind}]`}</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {fromHuman ? "" : "бот · "}
                  {new Date(t.at).toLocaleString("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {t.kind === "button_reply" && " · нажал кнопку"}
                  {t.kind === "template" && " · шаблон"}
                  {t.unrecognized && " · не понято"}
                </p>
              </div>
            </div>
          );
        })}
        {conv.timeline.length === 0 && <p className="text-sm text-slate-400">Переписки нет.</p>}
      </div>
    </Card>
  );
}
