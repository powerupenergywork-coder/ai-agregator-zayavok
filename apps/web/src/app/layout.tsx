import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI-агрегатор заявок",
  description: "Опишите, что вам нужно, и получите предложения от нескольких исполнителей",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
