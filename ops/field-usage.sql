-- Какие поля справочника работают, а какие только отнимают время.
--
-- Запускать раз в месяц. Поле, у которого доля заглушек выше половины, —
-- кандидат на удаление: человек на него ответить не может, а каждый лишний
-- вопрос стоит заявки.
--
-- Так 29 августа выяснилось, что «Объём» заполнялся 16 раз и 15 из них
-- заглушкой, а «Тип мусора» отвечался «Другое» в 17 случаях из 21. Оба
-- убраны; их работу делает пояснение — фраза клиента своими словами.
--
-- Заглушки — это три служебных значения из UNKNOWN_VALUE_OPTIONS:
-- «не знаю», «примерно», «нужна консультация».
--
-- Запуск:
--   docker-compose -f docker-compose.prod.yml exec -T postgres \
--     psql -U app -d ai_zayavki -f - < ops/field-usage.sql

\pset format aligned

WITH o AS (
  SELECT c.name->>'ru' AS cat, ord."fieldsData" AS d, ord."publishedAt" IS NOT NULL AS published
  FROM "Order" ord
  JOIN "Category" c ON c.id = ord."categoryId"
  WHERE NOT ord.internal AND ord."categoryId" IS NOT NULL
),
f AS (
  SELECT o.cat, kv.key, kv.value #>> '{}' AS val, o.published
  FROM o, jsonb_each(o.d) AS kv
)
SELECT
  cat                                                                    AS "категория",
  key                                                                    AS "поле",
  count(*)                                                               AS "заполнено",
  count(*) FILTER (WHERE val IN ('unknown','approximate','needs_consultation')) AS "заглушка",
  round(100.0 * count(*) FILTER (WHERE val IN ('unknown','approximate','needs_consultation')) / count(*)) AS "% заглушек",
  count(*) FILTER (WHERE val = 'other')                                  AS "другое",
  count(*) FILTER (WHERE published)                                      AS "дошло до рассылки"
FROM f
GROUP BY 1, 2
ORDER BY 5 DESC NULLS LAST, 3 DESC;
