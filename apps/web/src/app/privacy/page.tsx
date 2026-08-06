import Link from "next/link";
import { COMPANY } from "@/lib/company";

export const metadata = { title: "Политика конфиденциальности — KerekTap" };

/**
 * Deliberately plain Russian rather than boilerplate legalese: the one thing
 * a client has to actually understand before submitting an order is that
 * their phone number gets handed to suppliers, and burying that in a wall of
 * clauses would defeat the point of asking for consent at all.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-12">
      <h1 className="mb-2 text-2xl font-semibold">Политика конфиденциальности</h1>
      <p className="mb-8 text-sm text-slate-500">Сервис {COMPANY.brand} ({COMPANY.site})</p>

      <div className="flex flex-col gap-6 text-sm leading-relaxed text-slate-700">
        <section>
          <h2 className="mb-2 text-base font-medium text-slate-900">1. Кто обрабатывает данные</h2>
          <p>
            Оператором персональных данных является {COMPANY.legalName}, БИН {COMPANY.bin},
            адрес: {COMPANY.address}, телефон: {COMPANY.phone}.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium text-slate-900">2. Какие данные мы собираем</h2>
          <p className="mb-2">От заказчика:</p>
          <ul className="ml-5 list-disc">
            <li>номер телефона;</li>
            <li>описание задачи, город, адрес, дата и время, фотографии — всё, что вы указали в заявке;</li>
            <li>переписку с ботом в рамках оформления заявки — на сайте и в WhatsApp (см. п. 6 о сроке хранения).</li>
          </ul>
          <p className="mb-2 mt-3">От исполнителя:</p>
          <ul className="ml-5 list-disc">
            <li>номер телефона, название компании или имя;</li>
            <li>города и категории услуг, в которых он работает.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium text-slate-900">3. Главное: мы передаём ваш номер исполнителям</h2>
          <p>
            Смысл сервиса в том, чтобы исполнители могли позвонить вам напрямую. Поэтому после
            того, как вы подтверждаете заявку, <strong>ваш номер телефона вместе с описанием
            заявки отправляется тем исполнителям, которые работают в вашем городе и категории</strong>.
            Их может быть несколько. Подтверждая заявку, вы даёте на это согласие.
          </p>
          <p className="mt-2">
            Не подтверждайте заявку, если не хотите, чтобы вам звонили. Без подтверждения заявка
            никому не отправляется.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium text-slate-900">4. Зачем ещё мы используем данные</h2>
          <ul className="ml-5 list-disc">
            <li>подтвердить, что заявку оформили именно вы — сообщением в WhatsApp или SMS;</li>
            <li>показать статус заявки и историю ваших обращений;</li>
            <li>спросить через сутки, удалось ли решить вопрос;</li>
            <li>улучшать работу сервиса на обезличенной статистике.</li>
          </ul>
          <p className="mt-2">Мы не продаём данные и не передаём их никому, кроме исполнителей по вашей заявке.</p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium text-slate-900">5. Сторонние сервисы</h2>
          <p>
            Для работы мы используем: WhatsApp (Meta) — доставка сообщений; SMS-шлюз — доставка
            кодов, если WhatsApp недоступен; OpenAI — распознавание текста заявки. Им передаётся
            только то, что необходимо для конкретной операции.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium text-slate-900">6. Сколько храним</h2>
          <p className="mb-2">
            Данные заявки храним, пока это нужно для работы сервиса и разбора возможных споров.
          </p>
          <p className="mb-2">
            <strong>Переписку в WhatsApp — не дольше 7 дней.</strong> Мы сохраняем сообщения,
            которыми вы обменивались с нашим ботом, чтобы разобраться, если что-то пошло не так:
            заявка не дошла до исполнителей, бот не понял ответ, сообщение не доставилось.
            Через неделю переписка удаляется автоматически. Одноразовые коды подтверждения не
            сохраняются вовсе.
          </p>
          <p>
            Вы можете попросить удалить свои данные — напишите или позвоните по телефону,
            указанному выше. Мы удалим всё, что не обязаны хранить по закону.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium text-slate-900">7. Ваши права</h2>
          <p>
            Вы вправе узнать, какие ваши данные у нас есть, потребовать их исправления или
            удаления, а также отозвать согласие на обработку. Для этого свяжитесь с нами по
            телефону {COMPANY.phone}.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-medium text-slate-900">8. Изменения</h2>
          <p>
            Мы можем обновлять эту политику. Актуальная версия всегда находится по адресу
            {" "}{COMPANY.site}/privacy.
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
