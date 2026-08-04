import Link from "next/link";
import { COMPANY } from "@/lib/company";

export const metadata = { title: "Условия использования — KerekTap" };

/**
 * States the limits of the service plainly, because they are unusual and a
 * client who expects a guarantee will be disappointed by design: KerekTap
 * passes an order to suppliers and stops there. It takes no commission, holds
 * no money, and promises no one will answer.
 */
export default function TermsPage() {
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-12">
      <h1 className="mb-2 text-2xl font-semibold">Условия использования</h1>
      <p className="mb-8 text-sm text-slate-500">Сервис {COMPANY.brand} ({COMPANY.site})</p>

      <div className="flex flex-col gap-6 text-sm leading-relaxed text-slate-700">
        <section>
          <h2 className="mb-2 text-base font-medium text-slate-900">1. Что делает сервис</h2>
          <p>
            {COMPANY.brand} принимает вашу заявку и передаёт её исполнителям, которые работают в
            вашем городе и категории. Дальше исполнители связываются с вами напрямую по телефону.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium text-slate-900">2. Чего сервис не делает</h2>
          <p className="mb-2">Это важно понимать до подачи заявки:</p>
          <ul className="ml-5 list-disc">
            <li>
              <strong>Не гарантирует, что вам ответят.</strong> Если в вашем городе и категории
              нет свободных исполнителей, заявка может остаться без откликов.
            </li>
            <li>
              <strong>Не является стороной сделки.</strong> Обо всём — цене, сроках, объёме —
              вы договариваетесь с исполнителем напрямую.
            </li>
            <li>
              <strong>Не проводит платежи</strong> и не берёт комиссию с ваших расчётов.
            </li>
            <li>
              <strong>Не проверяет исполнителей.</strong> Мы не подтверждаем их квалификацию,
              наличие техники, лицензий и разрешений.
            </li>
            <li>
              <strong>Не разрешает споры</strong> между вами и исполнителем и не отвечает за
              качество, сроки и результат работ.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium text-slate-900">3. Обязанности заказчика</h2>
          <p>
            Указывайте достоверные данные. Не оформляйте заявки на чужой номер телефона.
            Не используйте сервис для незаконных целей.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium text-slate-900">4. Обязанности исполнителя</h2>
          <p className="mb-2">
            Получая заявку, исполнитель получает и телефон заказчика. Использовать его можно
            только для связи по этой заявке.
          </p>
          <p>
            Запрещено: рассылать рекламу, передавать контакты третьим лицам, беспокоить
            заказчика после его отказа. Нарушение — основание для блокировки без возврата
            оплаченной подписки.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium text-slate-900">5. Оплата для исполнителей</h2>
          <p>
            Заказчики пользуются сервисом бесплатно. Исполнителю определённое число уведомлений
            в месяц доступно бесплатно, дальше — по подписке. Условия и стоимость показываются
            в момент оформления подписки.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium text-slate-900">6. Ответственность</h2>
          <p>
            Сервис предоставляется «как есть». Мы стараемся, чтобы он работал без перебоев, но
            не гарантируем непрерывную доступность. Ответственность за отношения между
            заказчиком и исполнителем сервис не несёт.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium text-slate-900">7. Реквизиты</h2>
          <p>
            {COMPANY.legalName}, БИН {COMPANY.bin}, {COMPANY.address}, телефон {COMPANY.phone}.
          </p>
        </section>
      </div>

      <p className="mt-10 text-sm">
        <Link href="/" className="text-brand-600 underline decoration-dotted">
          На главную
        </Link>
      </p>
    </main>
  );
}
