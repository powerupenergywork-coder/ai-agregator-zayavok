-- Убрать поле «Тип мусора» из категории «Вывоз строительного мусора».
--
-- Справочник полей живёт в БД (Category.fields, jsonb), а не в коде: seed на
-- проде не запускается. Правка в category-seed-data.ts меняет только новые
-- установки, поэтому здесь то же самое для работающего сервера.
--
-- Зачем убираем. «Другое» — 16 значений из 23 по этой категории: перечень
-- просто не описывает то, что люди реально возят. Заявка №132: клиент
-- написал «Сухие смеси, вес 70кг», а исполнителям ушло «Тип мусора: Другое»
-- под заголовком «Вывоз строительного мусора». Вместо перечня исполнитель
-- теперь получает пояснение — фразу клиента как есть.
--
-- Старые заявки чистить не нужно: карточка и рассылка перебирают поля
-- КАТЕГОРИИ, поэтому значение в fieldsData перестаёт показываться само.
--
-- Запуск:
--   docker-compose -f docker-compose.prod.yml exec -T postgres \
--     psql -U app -d ai_zayavki -f - < ops/remove-waste-type-field.sql

BEGIN;

UPDATE "Category"
SET fields = COALESCE(
  (SELECT jsonb_agg(f ORDER BY ord)
   FROM jsonb_array_elements(fields) WITH ORDINALITY AS t(f, ord)
   WHERE f->>'key' <> 'wasteType'),
  '[]'::jsonb
)
WHERE slug = 'construction-waste';

-- Проверка: поля категории после правки.
SELECT slug, jsonb_agg(f->>'key' ORDER BY ord) AS keys
FROM "Category", jsonb_array_elements(fields) WITH ORDINALITY AS t(f, ord)
WHERE slug = 'construction-waste'
GROUP BY slug;

COMMIT;
