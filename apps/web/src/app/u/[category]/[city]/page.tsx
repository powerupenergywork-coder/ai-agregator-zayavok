import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LANDING_CATEGORIES, LANDING_CITIES, findLanding } from "@/lib/landing-pages";
import { LandingOrderForm } from "./order-form";

/**
 * Посадочная страница под конкретный запрос: «вывоз мусора Астана».
 *
 * Отдельная от главной именно потому, что человек ищет услугу, а не сервис:
 * на общую страницу про «AI-агрегатор заявок» он приходит с ощущением, что
 * попал не туда, и уходит. Сюда же ведут объявления — иначе платный клик
 * приземляется на текст, который не отвечает на запрос.
 *
 * Рендерится статически (generateStaticParams), поэтому не зависит от API во
 * время сборки и открывается мгновенно.
 */

export const dynamicParams = false;

export function generateStaticParams() {
  return LANDING_CATEGORIES.flatMap((category) =>
    LANDING_CITIES.map((city) => ({ category: category.slug, city: city.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string; city: string }>;
}): Promise<Metadata> {
  const { category, city } = await params;
  const found = findLanding(category, city);
  if (!found) return {};
  return {
    title: found.category.title(found.city),
    description: found.category.description(found.city),
    alternates: { canonical: `/u/${category}/${city}` },
  };
}

export default async function LandingCityPage({
  params,
}: {
  params: Promise<{ category: string; city: string }>;
}) {
  const { category: categorySlug, city: citySlug } = await params;
  const found = findLanding(categorySlug, citySlug);
  if (!found) notFound();
  const { category, city } = found;

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-10">
      <h1 className="mb-3 text-2xl font-semibold text-slate-900">{category.h1(city)}</h1>
      <p className="mb-6 text-slate-600">{category.intro(city)}</p>

      <LandingOrderForm categorySlug={category.categorySlug} examples={category.examples} />

      <section className="mt-10 text-sm text-slate-600">
        <h2 className="mb-2 text-base font-medium text-slate-900">Как это работает</h2>
        <ol className="ml-5 list-decimal space-y-1">
          <li>Вы описываете задачу своими словами — бот уточнит детали.</li>
          <li>Подтверждаете номер одним нажатием в WhatsApp.</li>
          <li>Заявка уходит исполнителям {city.inCity}, они звонят вам напрямую.</li>
          <li>Вы сравниваете цены и договариваетесь с тем, кто устроил.</li>
        </ol>
        <p className="mt-4">
          Комиссию с заказа не берём и в сделку не вмешиваемся — вы общаетесь с исполнителем
          напрямую.
        </p>
      </section>

      <nav className="mt-10 border-t border-slate-200 pt-6 text-sm">
        <h2 className="mb-2 font-medium text-slate-900">Другие услуги {city.inCity}</h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-2">
          {LANDING_CATEGORIES.filter((c) => c.slug !== category.slug).map((c) => (
            <li key={c.slug}>
              <a className="text-brand-600 underline" href={`/u/${c.slug}/${city.slug}`}>
                {c.h1(city)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
