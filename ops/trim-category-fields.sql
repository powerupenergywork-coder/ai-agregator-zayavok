-- Убрать поля, на которые клиент не знает ответа.
--
-- Данные с прода на 29 августа: «Объём» заполнялся 16 раз и 15 из них
-- заглушкой «не знаю»/«примерно». «Вес» у газели — один раз и заглушкой.
-- Грузоподъёмность автокрана — два раза из трёх. Содержательного ответа эти
-- поля не дают практически никогда.
--
-- Это не поломка распознавания. Заказчик правда не знает, сколько кубов у
-- него мусора: в кубах и тоннах меряет тот, кто возит. А каждый лишний
-- вопрос стоит заявки — до адреса, который спрашивается позже, доходят
-- девять человек из тридцати двух.
--
-- Взамен работает пояснение: фраза клиента своими словами уходит исполнителю
-- первой строкой. «Сухие смеси, вес 70кг» полезнее, чем «Объём: не знаю».
--
-- Старые заявки чистить не нужно: карточка и рассылка перебирают поля
-- КАТЕГОРИИ, поэтому значения в fieldsData перестают показываться сами.
--
-- Запуск:
--   docker-compose -f docker-compose.prod.yml exec -T postgres \
--     psql -U app -d ai_zayavki -f - < ops/trim-category-fields.sql

BEGIN;

-- construction-waste: volumeM3
UPDATE "Category"
SET fields = COALESCE(
  (SELECT jsonb_agg(f ORDER BY ord)
   FROM jsonb_array_elements(fields) WITH ORDINALITY AS t(f, ord)
   WHERE f->>'key' NOT IN ('volumeM3')),
  '[]'::jsonb
)
WHERE slug = 'construction-waste';

-- gazelle: weightKg, volumeM3
UPDATE "Category"
SET fields = COALESCE(
  (SELECT jsonb_agg(f ORDER BY ord)
   FROM jsonb_array_elements(fields) WITH ORDINALITY AS t(f, ord)
   WHERE f->>'key' NOT IN ('weightKg', 'volumeM3')),
  '[]'::jsonb
)
WHERE slug = 'gazelle';

-- crane: liftWeightTons, liftHeightM
UPDATE "Category"
SET fields = COALESCE(
  (SELECT jsonb_agg(f ORDER BY ord)
   FROM jsonb_array_elements(fields) WITH ORDINALITY AS t(f, ord)
   WHERE f->>'key' NOT IN ('liftWeightTons', 'liftHeightM')),
  '[]'::jsonb
)
WHERE slug = 'crane';

-- crane-truck: weightTons, dimensions
UPDATE "Category"
SET fields = COALESCE(
  (SELECT jsonb_agg(f ORDER BY ord)
   FROM jsonb_array_elements(fields) WITH ORDINALITY AS t(f, ord)
   WHERE f->>'key' NOT IN ('weightTons', 'dimensions')),
  '[]'::jsonb
)
WHERE slug = 'crane-truck';

-- dump-truck: volumeM3
UPDATE "Category"
SET fields = COALESCE(
  (SELECT jsonb_agg(f ORDER BY ord)
   FROM jsonb_array_elements(fields) WITH ORDINALITY AS t(f, ord)
   WHERE f->>'key' NOT IN ('volumeM3')),
  '[]'::jsonb
)
WHERE slug = 'dump-truck';

-- Проверка: что осталось у каждой категории.
SELECT slug, jsonb_agg(f->>'key' ORDER BY ord) AS keys
FROM "Category", jsonb_array_elements(fields) WITH ORDINALITY AS t(f, ord)
WHERE "isActive"
GROUP BY slug ORDER BY slug;

COMMIT;
