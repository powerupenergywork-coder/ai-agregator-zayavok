import type { Metadata } from "next";
import "./globals.css";
import { LocaleProvider } from "@/lib/i18n/context";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "KerekTap — AI-агрегатор заявок",
  description: "Опишите, что вам нужно, и получите предложения от нескольких исполнителей",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <LocaleProvider>
          <Logo className="fixed left-3 top-3 z-50" />
          <LanguageSwitcher />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
