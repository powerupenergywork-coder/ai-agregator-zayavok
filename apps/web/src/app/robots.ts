import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Закрываем от индексации всё, что не является публичной страницей услуги.
 *
 * Карточка заявки открывается по неугадываемому токену и содержит адрес и
 * телефон клиента — такое не должно попадать в поисковую выдачу ни при каких
 * обстоятельствах. Админка и кабинет исполнителя закрыты по той же причине.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/orders/", "/s/", "/confirm/", "/account"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
