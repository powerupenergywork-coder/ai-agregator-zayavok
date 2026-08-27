-- Разовая разметка уже накопленных служебных заявок.
--
-- Новые помечаются сами (OrdersService.markInternalIfNotClient и
-- discardDraftAsInternal), но всё, что заведено до появления колонки, лежит в
-- статистике как клиентское. Из-за этого в отчёте от 28 августа повторным
-- клиентом оказался человек, который просто четыре раза не смог
-- зарегистрироваться исполнителем.
--
-- Три правила, а не список номеров: список устареет к следующему разу.
--
-- Запуск:
--   docker-compose -f docker-compose.prod.yml exec -T postgres \
--     psql -U app -d ai_zayavki -f - < ops/mark-internal-orders.sql

BEGIN;

-- Телефон заявки: у веб-заявки он в профиле клиента, у whatsapp-черновика —
-- только в сессии, пока заявка не опубликована.
CREATE TEMP VIEW order_phone AS
SELECT o.id, o.number, o."publishedAt", o.source,
       coalesce(u.phone, w.phone) AS phone
FROM "Order" o
LEFT JOIN "ClientProfile" cp ON cp.id = o."clientId"
LEFT JOIN "User" u ON u.id = cp."userId"
LEFT JOIN LATERAL (
  SELECT s.phone FROM "WhatsAppSession" s WHERE s."currentOrderId" = o.id LIMIT 1
) w ON true;

-- 1. Служебные проверки: дымовые тесты и health-check.
UPDATE "Order" SET internal = true
WHERE source IN ('smoke-test', 'smoke-test-price', 'health-check');

-- 2. Заявки с номера владельца — его собственные проверки (№97, 98, 112).
--    Помечаем независимо от статуса: опубликованный тест остаётся тестом.
UPDATE "Order" o SET internal = true
FROM order_phone p
WHERE p.id = o.id
  AND p.phone IS NOT NULL
  AND regexp_replace(p.phone, '\D', '', 'g') = regexp_replace('+77787098251', '\D', '', 'g');

-- 3. Неопубликованные черновики с номера, который есть в базе исполнителей.
--
--    Только черновики: если исполнитель и правда заказал газель и заявка
--    дошла до рассылки — это настоящая сделка, а не мусор. А вот брошенный
--    черновик с номера исполнителя это почти всегда хвост неудачной попытки
--    зарегистрироваться (№123–126).
UPDATE "Order" o SET internal = true
FROM order_phone p
WHERE p.id = o.id
  AND p."publishedAt" IS NULL
  AND EXISTS (
    SELECT 1 FROM "SupplierProfile" s JOIN "User" su ON su.id = s."userId"
    WHERE regexp_replace(su.phone, '\D', '', 'g') = regexp_replace(p.phone, '\D', '', 'g')
  );

-- ── Что получилось ──────────────────────────────────────────────────────────
SELECT count(*) FILTER (WHERE internal) AS "служебных",
       count(*) FILTER (WHERE NOT internal) AS "клиентских"
FROM "Order";

SELECT number, status, internal, coalesce(source, '—') AS source
FROM "Order" WHERE internal ORDER BY number;

COMMIT;
