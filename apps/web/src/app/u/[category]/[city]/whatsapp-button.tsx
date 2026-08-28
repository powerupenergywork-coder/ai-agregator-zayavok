"use client";

import { useEffect, useState } from "react";
import { captureAttribution } from "@/lib/attribution";
import { adClickToken, withAdToken } from "@/lib/ad-click";
import { whatsappLink } from "@/lib/site";
import { analyticsApi } from "@/lib/api";

/**
 * Кнопка в WhatsApp со страницы услуги.
 *
 * Вынесена в клиентский компонент ради одного: код клика по объявлению.
 * Страница услуги собирается статически, а код выдаётся в браузере — ссылка,
 * построенная на сборке, донести его не может.
 *
 * Именно сюда и приземляется реклама: все заявки с gclid пришли с
 * /u/vyvoz-musora/astana, ни одной с главной. Пока кнопка была статической,
 * идентификатор клика обрывался на переходе в чат, и в Google Ads стоял ноль
 * конверсий по самой рабочей посадочной.
 *
 * captureAttribution здесь вызывается тоже намеренно: на этой странице
 * клиентской формы может не быть в кадре, а метки из адреса нужно снять до
 * того, как человек уйдёт в WhatsApp.
 */
export function WhatsAppButton({ text, label }: { text: string; label: string }) {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    captureAttribution();
    // Заход на эту страницу нигде не считался, а именно сюда ведёт реклама:
    // на вопрос «клики есть, заявок нет» отвечать было нечем — не видно даже,
    // доходят ли люди до страницы. Событие то же, что на главной: обе они
    // посадочные, и складывать их в один счётчик правильно.
    analyticsApi.track("landing_view").catch(() => {});
    // Без gclid в адресе вернётся null, и ссылка останется прежней.
    adClickToken().then(setToken);
  }, []);

  return (
    <a
      href={whatsappLink(withAdToken(text, token))}
      className="flex items-center justify-center gap-2 rounded-full bg-[#25D366] px-6 py-3.5 text-base font-semibold text-white shadow-sm transition hover:brightness-95"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
        <path d="M12 2a10 10 0 0 0-8.7 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2Zm5.6 14.2c-.2.7-1.4 1.3-2 1.3-.5 0-1.1.2-3.7-.8-3.1-1.3-5-4.4-5.2-4.6-.1-.2-1.2-1.6-1.2-3s.8-2.1 1-2.4c.3-.3.6-.4.8-.4h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .5l-.4.6-.3.3c-.1.2-.3.3-.1.6.1.3.7 1.2 1.5 1.9 1 .9 1.8 1.2 2.1 1.3.2.1.4.1.6-.1l.8-1c.2-.2.3-.2.6-.1l2 1c.3.1.5.2.5.3.1.2.1.8-.1 1.5Z" />
      </svg>
      {label}
    </a>
  );
}
