import type { Metadata } from "next";
import "./globals.css";
import { SITE_URL } from "@/lib/site";
import { LocaleProvider } from "@/lib/i18n/context";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Logo } from "@/components/logo";
import { Footer } from "@/components/footer";

/**
 * Заголовок для поиска, а не для нас.
 *
 * Был «KerekTap — AI-агрегатор заявок»: внутреннее название проекта, в
 * котором нет ни одного слова из того, что люди ищут. Человек набирает
 * «манипулятор астана», видит в выдаче «AI-агрегатор заявок» и не кликает —
 * это описание технологии, а не услуги.
 *
 * Техника перечислена намеренно: по этим словам страницу и находят.
 *
 * openGraph нужен отдельно от title: ссылку на сервис пересылают в WhatsApp,
 * и там показывается именно он. Без него в чате виден голый адрес.
 */
export const metadata: Metadata = {
  // Длина подобрана под выдачу: заголовок обрезается примерно на 60 знаках,
  // описание на 160. Всё, что дальше, человек не увидит, поэтому главное
  // стоит в начале, а бренд — в конце, где потеря не страшна.
  title: "Манипулятор, самосвал, автокран в Астане — KerekTap",
  description:
    "Опишите задачу в WhatsApp — исполнители в Астане перезвонят вам напрямую. " +
    "Манипулятор, автокран, самосвал, газель, грузчики, вывоз мусора.",
  openGraph: {
    title: "Спецтехника в Астане — KerekTap",
    description: "Опишите задачу своими словами, исполнители перезвонят вам напрямую.",
    url: SITE_URL,
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <LocaleProvider>
          <Logo className="fixed left-3 top-3 z-50" />
          <LanguageSwitcher />
          {children}
          <Footer />
        </LocaleProvider>
      </body>
    </html>
  );
}
