"use client";

import Link from "next/link";
import { COMPANY } from "@/lib/company";
import { useLocale } from "@/lib/i18n/context";

/**
 * Carries the operator's registration details on every page. Meta checks the
 * site during business verification and looks for exactly this — a site with
 * no company behind it is one of the commonest grounds for rejection.
 */
export function Footer() {
  const { t } = useLocale();
  return (
    <footer className="mt-12 border-t border-slate-100 px-4 py-8 text-xs leading-relaxed text-slate-500">
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        <div>
          <p className="font-medium text-slate-600">{COMPANY.legalName}</p>
          <p>БИН {COMPANY.bin}</p>
          <p>{COMPANY.address}</p>
          <p>
            <a href={`tel:${COMPANY.phoneHref}`} className="hover:text-slate-700">
              {COMPANY.phone}
            </a>
          </p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/privacy" className="underline decoration-dotted hover:text-slate-700">
            {t.footer.privacy}
          </Link>
          <Link href="/terms" className="underline decoration-dotted hover:text-slate-700">
            {t.footer.terms}
          </Link>
          {/* Единственный вход для исполнителя на всём сайте: раньше страниц
              для него не было вовсе, и человек, получивший наше приглашение,
              не находил о нас ничего. */}
          <Link href="/dlya-ispolniteley" className="underline decoration-dotted hover:text-slate-700">
            {t.footer.forSuppliers}
          </Link>
        </div>
        <p className="text-slate-400">{t.footer.disclaimer}</p>
      </div>
    </footer>
  );
}
