"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Language } from "@ai-zayavki/shared";
import { detectLanguage } from "@ai-zayavki/shared";
import { ru, type Dictionary } from "./dictionaries/ru";
import { kk } from "./dictionaries/kk";

const STORAGE_KEY = "az_locale";
const dictionaries: Record<Language, Dictionary> = { ru, kk };

interface LocaleContextValue {
  locale: Language;
  setLocale: (locale: Language) => void;
  /** Runs detectLanguage() on free-typed text and switches locale if it
   * confidently resolves to Kazakh — same "however they addressed us" logic
   * as the WhatsApp bot (see packages/shared/src/language.ts). */
  detectFromText: (text: string) => void;
  t: Dictionary;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function initialLocale(): Language {
  if (typeof window === "undefined") return "ru";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "ru" || stored === "kk") return stored;
  return navigator.language?.toLowerCase().startsWith("kk") ? "kk" : "ru";
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Language>("ru");

  useEffect(() => {
    setLocaleState(initialLocale());
  }, []);

  const setLocale = useCallback((next: Language) => {
    setLocaleState(next);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const detectFromText = useCallback(
    (text: string) => {
      const detected = detectLanguage(text);
      if (detected) setLocale(detected);
    },
    [setLocale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, detectFromText, t: dictionaries[locale] }),
    [locale, setLocale, detectFromText],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}
