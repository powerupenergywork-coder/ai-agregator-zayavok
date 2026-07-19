import type { Metadata } from "next";
import "./globals.css";
import { LocaleProvider } from "@/lib/i18n/context";
import { LanguageSwitcher } from "@/components/language-switcher";

export const metadata: Metadata = {
  title: "AI-агрегатор заявок",
  description: "Опишите, что вам нужно, и получите предложения от нескольких исполнителей",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <LocaleProvider>
          <LanguageSwitcher />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
