"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { categoriesApi, CategoryTemplateDto, ordersApi, analyticsApi } from "@/lib/api";
import { useLocale } from "@/lib/i18n/context";
import { Button, Chip, Spinner } from "@/components/ui";

export default function LandingPage() {
  const router = useRouter();
  const { locale, t, detectFromText } = useLocale();
  const [categories, setCategories] = useState<CategoryTemplateDto[]>([]);
  const [message, setMessage] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    categoriesApi.listActive().then(setCategories).catch(() => setCategories([]));
    analyticsApi.track("landing_view");
  }, []);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = locale === "kk" ? "kk-KZ" : "ru-RU";
    recognition.interimResults = false;
    recognition.onresult = (e: any) => {
      const text = e.results[0][0].transcript;
      setMessage((prev) => (prev ? `${prev} ${text}` : text));
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
  }, [locale]);

  const toggleVoice = () => {
    if (!recognitionRef.current) return;
    if (listening) {
      recognitionRef.current.stop();
      setListening(false);
    } else {
      recognitionRef.current.start();
      setListening(true);
    }
  };

  const submit = async (text: string) => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      const draft = await ordersApi.createDraft(undefined, urgent);
      await analyticsApi.track("order_draft_started", { orderId: draft.id });
      await ordersApi.chat(draft.id, text.trim(), locale);
      router.push(`/orders/${draft.id}`);
    } catch (e) {
      setSubmitting(false);
      alert(t.landing.submitError);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-16">
      <h1 className="text-center text-2xl font-semibold text-slate-900 sm:text-3xl">{t.landing.headline}</h1>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <textarea
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            detectFromText(e.target.value);
          }}
          placeholder={t.landing.placeholder}
          rows={3}
          className="w-full resize-none rounded-xl border-0 p-3 text-base text-slate-900 outline-none placeholder:text-slate-400"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(message);
            }
          }}
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <button
            type="button"
            onClick={toggleVoice}
            title={t.landing.voiceInput}
            className={`rounded-full p-2 text-lg ${listening ? "bg-red-50 text-red-600" : "text-slate-400 hover:bg-slate-100"}`}
          >
            🎙
          </button>
          <Button onClick={() => submit(message)} disabled={submitting || !message.trim()}>
            {submitting ? <Spinner /> : t.landing.send}
          </Button>
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2 self-center text-sm text-slate-600">
        <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
        {t.landing.urgentLabel}
      </label>

      <div className="mt-8">
        <p className="mb-2 text-center text-sm text-slate-500">{t.landing.orExample}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {(categories.length > 0
            ? categories.flatMap((c) => c.examples.slice(0, 1).map((ex) => ex[locale]))
            : t.landing.fallbackExamples
          ).map((example) => (
            <Chip key={example} onClick={() => submit(example)} disabled={submitting}>
              {example}
            </Chip>
          ))}
        </div>
      </div>

      {categories.length > 0 && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {categories.map((c) => (
            <Chip key={c.slug} onClick={() => setMessage(`${c.name[locale]}: `)} className="text-slate-500">
              {c.name[locale]}
            </Chip>
          ))}
        </div>
      )}

      <p className="mt-10 text-center text-xs text-slate-400">{t.landing.disclaimer}</p>
    </main>
  );
}
