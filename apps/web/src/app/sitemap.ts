import type { MetadataRoute } from "next";
import { LANDING_CATEGORIES, LANDING_CITIES } from "@/lib/landing-pages";
import { SITE_URL } from "@/lib/site";

/**
 * В карту попадают только страницы, которые имеет смысл показывать в поиске:
 * главная, посадочные под услуги и юридические. Карточки заявок и кабинеты
 * сюда не входят — они закрыты в robots.ts и содержат личные данные.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const landings = LANDING_CATEGORIES.flatMap((category) =>
    LANDING_CITIES.map((city) => ({
      url: `${SITE_URL}/u/${category.slug}/${city.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  );

  return [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    ...landings,
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
