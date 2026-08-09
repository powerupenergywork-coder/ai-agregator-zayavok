"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ordersApi } from "@/lib/api";
import { captureAttribution, getAttribution } from "@/lib/attribution";
import { Button } from "@/components/ui";

/**
 * Форма на посадочной странице.
 *
 * Категория известна заранее — человек пришёл по запросу «нужен автокран», и
 * переспрашивать «что вам нужно?» после этого значит терять его на ровном
 * месте. Поэтому черновик сразу создаётся нужного типа, и диалог начинается с
 * деталей, а не с выбора категории.
 */
export function LandingOrderForm({
  categorySlug,
  cityName,
  examples,
}: {
  categorySlug: string;
  cityName: string;
  examples: string[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    captureAttribution();
  }, []);

  const submit = async () => {
    if (!message.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const draft = await ordersApi.createDraft(categorySlug, false, getAttribution());
      // Город известен из адреса страницы — человек пришёл на «грузчики в
      // Астане». Переспрашивать его значит задать вопрос, ответ на который
      // мы уже знаем, а на платном трафике каждый лишний вопрос стоит денег.
      //
      // Молча: если проставить не вышло, бот просто спросит город сам, как
      // раньше. Терять из-за этого заявку нельзя.
      try {
        await ordersApi.setField(draft.id, "city", cityName);
      } catch {
        // не критично — вопрос про город останется в диалоге
      }
      await ordersApi.chat(draft.id, message.trim());
      router.push(`/orders/${draft.id}`);
    } catch (e: any) {
      setError(e.message ?? "Не удалось создать заявку");
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <label className="mb-2 block text-sm font-medium text-slate-900">Опишите задачу</label>
      <textarea
        className="mb-3 h-28 w-full resize-none rounded border border-slate-300 px-3 py-2 text-sm"
        placeholder={examples[0]}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setMessage(ex)}
            className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600"
          >
            {ex}
          </button>
        ))}
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <Button onClick={submit} disabled={!message.trim() || submitting}>
        {submitting ? "Отправляем…" : "Найти исполнителей"}
      </Button>
      <p className="mt-2 text-xs text-slate-500">Без регистрации. Номер понадобится только для подтверждения заявки.</p>
    </div>
  );
}
