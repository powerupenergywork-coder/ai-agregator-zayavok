"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n/context";
import { publicApi, SupplierStatsDto } from "@/lib/api";
import { COMPANY } from "@/lib/company";

/**
 * Страница для исполнителей.
 *
 * Отвечает на три вопроса, которые реально задавали живые люди, а не на те,
 * что удобно рассказать о себе. «Вы кто люди» — первое, что спросил Багдат,
 * получив приглашение. «Есть еще заказы» — первое, что спросил Айдос,
 * согласившись. И «откуда у вас мой номер» — то, о чём думают все, но пишут
 * немногие.
 *
 * Формы регистрации здесь нет намеренно. Она уже работает в WhatsApp и
 * занимает минуту: Нуржан прошёл её за 90 секунд кнопками. Веб-форма
 * конкурировала бы с рабочим сценарием и проиграла бы — человек за рулём
 * крана не заполняет поля в браузере. Единственная кнопка ведёт в тот же
 * чат с готовым словом «поставщик», на которое бот запускает регистрацию.
 */
export default function SuppliersPage() {
  const { t, locale } = useLocale();
  const [stats, setStats] = useState<SupplierStatsDto | null>(null);

  useEffect(() => {
    publicApi.supplierStats().then(setStats).catch(() => setStats(null));
  }, []);

  const s = t.suppliers;
  // Слово «поставщик» боту — уже существующий триггер регистрации, отдельного
  // входа заводить не пришлось.
  const waLink = stats?.botPhone
    ? `https://wa.me/${stats.botPhone}?text=${encodeURIComponent("поставщик")}`
    : undefined;

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">{s.headline}</h1>
      <p className="mt-4 text-base text-slate-600">{s.subhead}</p>

      <div className="mt-8">
        <CtaButton href={waLink} label={s.cta} />
        <p className="mt-2 text-sm text-slate-500">{s.ctaNote}</p>
      </div>

      {stats && (
        <section className="mt-12">
          <h2 className="mb-3 text-lg font-medium text-slate-900">{s.statsTitle}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat value={stats.suppliers} label={s.statSuppliers} />
            <Stat value={stats.categories.length} label={s.statCategories} />
            <Stat value={stats.cities.length} label={s.statCities} />
            {/* Блок спроса появляется сам, когда заявок станет достаточно,
                чтобы цифра убеждала, а не отпугивала (см. PublicService). */}
            {stats.ordersLastWeek !== null && (
              <Stat value={stats.ordersLastWeek} label={s.statOrdersWeek} />
            )}
          </div>
          <p className="mt-3 text-sm text-slate-500">
            {s.ordersHint}: {stats.categories.map((c) => c.name[locale]).join(", ")}
          </p>
        </section>
      )}

      <section className="mt-12">
        <h2 className="mb-4 text-lg font-medium text-slate-900">{s.howTitle}</h2>
        <ol className="space-y-4">
          <Step n={1} title={s.how1Title} text={s.how1Text} />
          <Step n={2} title={s.how2Title} text={s.how2Text} />
          <Step n={3} title={s.how3Title} text={s.how3Text} />
        </ol>
      </section>

      <section className="mt-12 rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <h2 className="mb-2 text-lg font-medium text-slate-900">{s.priceTitle}</h2>
        {stats && (
          <>
            <p className="text-slate-700">{s.priceFree(stats.freeQuota)}</p>
            <p className="text-slate-700">{s.pricePaid(stats.priceTenge, stats.periodDays)}</p>
          </>
        )}
        <p className="mt-2 font-medium text-slate-900">{s.priceNoCommission}</p>
      </section>

      <section className="mt-12">
        <h2 className="mb-4 text-lg font-medium text-slate-900">{s.faqTitle}</h2>
        <div className="space-y-4">
          <Faq q={s.faq1Q} a={s.faq1A} />
          <Faq q={s.faq2Q} a={s.faq2A} />
          <Faq q={s.faq3Q} a={s.faq3A} />
          <Faq q={s.faq4Q} a={s.faq4A} />
          <Faq q={s.faq5Q} a={s.faq5A(COMPANY.bin)} />
        </div>
      </section>

      <div className="mt-12">
        <CtaButton href={waLink} label={s.cta} />
      </div>

      <section className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-500">
        <h2 className="mb-2 font-medium text-slate-700">{s.contactsTitle}</h2>
        <p>{COMPANY.legalName}</p>
        <p>БИН {COMPANY.bin}</p>
        <p>
          <a href={`tel:${COMPANY.phoneHref}`} className="text-brand-700 underline">
            {COMPANY.phone}
          </a>
        </p>
        <p className="mt-3">
          <Link href="/" className="text-brand-700 underline">
            kerektap.kz
          </Link>
        </p>
      </section>
    </main>
  );
}

/** Ссылка, а не кнопка с обработчиком: она должна открываться в приложении
 *  WhatsApp, а на десктопе — в web.whatsapp.com, и это умеет сам браузер. */
function CtaButton({ href, label }: { href?: string; label: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center justify-center rounded-xl bg-brand-600 px-6 py-3 text-base font-medium text-white hover:bg-brand-700"
    >
      {label}
    </a>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
      <p className="text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{label}</p>
    </div>
  );
}

function Step({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-medium text-white">
        {n}
      </span>
      <div>
        <p className="font-medium text-slate-900">{title}</p>
        <p className="text-slate-600">{text}</p>
      </div>
    </li>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <p className="font-medium text-slate-900">{q}</p>
      <p className="text-slate-600">{a}</p>
    </div>
  );
}
