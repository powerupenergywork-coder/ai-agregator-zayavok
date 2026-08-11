"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { categoriesApi, CategoryTemplateDto, ordersApi, analyticsApi, publicApi } from "@/lib/api";
import { captureAttribution, getAttribution } from "@/lib/attribution";
import Link from "next/link";
import { useLocale } from "@/lib/i18n/context";
import { Button, Chip, Spinner } from "@/components/ui";
import { ServiceIcon, SERVICE_ICON_KEYS } from "@/components/service-icon";

export default function LandingPage() {
  const router = useRouter();
  const { locale, t, detectFromText } = useLocale();
  const [categories, setCategories] = useState<CategoryTemplateDto[]>([]);
  const [message, setMessage] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [listening, setListening] = useState(false);
  const [botPhone, setBotPhone] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    captureAttribution();
    categoriesApi.listActive().then(setCategories).catch(() => setCategories([]));
    analyticsApi.track("landing_view");
    publicApi.supplierStats().then((s) => setBotPhone(s.botPhone)).catch(() => setBotPhone(null));
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
      const draft = await ordersApi.createDraft(undefined, urgent, getAttribution());
      await analyticsApi.track("order_draft_started", { orderId: draft.id });
      await ordersApi.chat(draft.id, text.trim(), locale);
      router.push(`/orders/${draft.id}`);
    } catch (e) {
      setSubmitting(false);
      alert(t.landing.submitError);
    }
  };

  return (
    // justify-center убран: с появлением блоков про услуги и порядок работы
    // страница стала длиннее экрана, и центрирование по вертикали уводило
    // форму вниз — человек попадал на пустоту вместо поля ввода.
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-16">
      {/* Заголовок — вопрос, а не описание услуги.
       *
       * Было: «Опишите, что вам нужно, и получите предложения от нескольких
       * исполнителей» — длинное предложение канцелярским языком, где главное
       * слово («техника») не встречается вовсе. Человек с телефона читает
       * первые три слова и решает, его это или нет.
       *
       * Стало: вопрос, на который у пришедшего уже есть ответ, и отдельной
       * строкой — что произойдёт дальше. */}
      <h1 className="text-center text-2xl font-bold text-slate-900 sm:text-3xl">{t.landing.headline}</h1>
      <p className="mt-3 text-center text-base leading-snug text-slate-600">{t.landing.subheadline}</p>

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

      {/* Второй путь для тех, кто не станет печатать в форму.
       *
       * За три дня рекламы страницу открыли 380 раз и ни разу не начали
       * заявку. Форма требует набрать текст в незнакомом интерфейсе; в
       * WhatsApp человек печатает каждый день и порог там заметно ниже.
       *
       * Текст сообщения предзаполнен — по нему бот сразу понимает, что перед
       * ним заказчик, и не спрашивает «вам нужна услуга или вы исполнитель?».
       *
       * Ссылка появляется только когда номер пришёл с сервера: кнопка,
       * ведущая в пустоту, хуже отсутствующей. */}
      {botPhone && (
        <div className="mt-6 flex flex-col items-center">
          <a
            href={`https://wa.me/${botPhone}?text=${encodeURIComponent(t.landing.whatsappPrefill)}`}
            className="inline-flex items-center gap-2 rounded-full bg-[#25D366] px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:brightness-95"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
              <path d="M12 2a10 10 0 0 0-8.7 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2Zm5.6 14.2c-.2.7-1.4 1.3-2 1.3-.5 0-1.1.2-3.7-.8-3.1-1.3-5-4.4-5.2-4.6-.1-.2-1.2-1.6-1.2-3s.8-2.1 1-2.4c.3-.3.6-.4.8-.4h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .5l-.4.6-.3.3c-.1.2-.3.3-.1.6.1.3.7 1.2 1.5 1.9 1 .9 1.8 1.2 2.1 1.3.2.1.4.1.6-.1l.8-1c.2-.2.3-.2.6-.1l2 1c.3.1.5.2.5.3.1.2.1.8-.1 1.5Z" />
            </svg>
            {t.landing.whatsappCta}
          </a>
          <p className="mt-2 text-center text-xs text-slate-500">{t.landing.whatsappHint}</p>
        </div>
      )}

      <div className="mt-8">
        <p className="mb-2 text-center text-sm text-slate-500">{t.landing.orExample}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {(categories.length > 0
            ? categories.flatMap((c) => c.examples.slice(0, 1).map((ex) => ex[locale]))
            : t.landing.fallbackExamples
          ).map((example) => (
            // Подсказка ПОДСТАВЛЯЕТ текст, а не отправляет его.
            //
            // Раньше клик сразу заводил заявку, и любой любопытный тык
            // становился записью в базе: из 29 застрявших заявок 17 состоят
            // ровно из одной реплики, совпадающей с текстом подсказки, —
            // «Нужен кран поднять груз» встречается девять раз. Теперь
            // отправляет человек, когда действительно этого хочет.
            <Chip key={example} onClick={() => setMessage(example)} disabled={submitting}>
              {example}
            </Chip>
          ))}
        </div>
      </div>

      {/* Ряд чипов с одними названиями категорий убран: ниже те же шесть
          услуг показаны карточками с иконкой и пояснением. Два списка одного
          и того же — это не выбор, а лишний шум. */}

      {/* Что мы вообще делаем — словами, а не названиями категорий.
       *
       * До этого страница спрашивала «Что вам нужно?» и показывала чипы с
       * названиями техники. Человек, попавший сюда из рекламы, не всегда
       * знает, что его задача называется «манипулятор»: он знает, что надо
       * поднять профлист на крышу. Описание переводит с его языка на наш.
       *
       * За три дня рекламы страницу открыли 380 раз и ни разу не начали
       * заявку — это первое, что стоило объяснить понятнее. */}
      <section className="mt-12">
        <h2 className="mb-4 text-center text-lg font-semibold text-slate-900">{t.landing.servicesTitle}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {t.landing.services.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setMessage(`${s.name}: `)}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand-400 hover:shadow-sm"
            >
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                <ServiceIcon name={SERVICE_ICON_KEYS[i]} className="h-7 w-7" />
              </span>
              <span>
                <span className="block font-medium text-slate-900">{s.name}</span>
                <span className="mt-1 block text-sm leading-snug text-slate-600">{s.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="mb-4 text-center text-lg font-semibold text-slate-900">{t.landing.howTitle}</h2>
        <ol className="flex flex-col gap-3">
          {t.landing.how.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                {i + 1}
              </span>
              <span className="pt-0.5 text-sm leading-snug text-slate-700">{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-center text-sm text-slate-500">{t.landing.howNote}</p>
      </section>

      {/* Единственная заметная дверь для исполнителя на клиентской странице.
          В подвале он её не найдёт: туда не смотрят, а половина исполнителей
          попадает на главную по прямой ссылке из нашего же сообщения. */}
      <p className="mt-10 text-center text-sm">
        <Link href="/dlya-ispolniteley" className="text-brand-700 underline decoration-dotted">
          {t.landing.forSuppliers}
        </Link>
      </p>

      <p className="mt-4 text-center text-xs text-slate-400">{t.landing.disclaimer}</p>
    </main>
  );
}
