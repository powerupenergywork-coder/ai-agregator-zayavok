"use client";

import { useLocale } from "@/lib/i18n/context";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useLocale();

  return (
    <div className="fixed right-3 top-3 z-50 flex overflow-hidden rounded-full border border-slate-200 bg-white text-xs shadow-sm">
      <button
        type="button"
        onClick={() => setLocale("ru")}
        className={`px-2.5 py-1 ${locale === "ru" ? "bg-brand-600 text-white" : "text-slate-500"}`}
      >
        {t.languageSwitcher.ru}
      </button>
      <button
        type="button"
        onClick={() => setLocale("kk")}
        className={`px-2.5 py-1 ${locale === "kk" ? "bg-brand-600 text-white" : "text-slate-500"}`}
      >
        {t.languageSwitcher.kk}
      </button>
    </div>
  );
}
