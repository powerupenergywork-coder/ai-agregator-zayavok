-- Canonicalise the city strings that were written before the city dictionary
-- existed (see packages/shared/src/cities.ts). Until now both sides of the
-- match were free text, so production held rows like "Астана Алмата" — one
-- field, two cities, matching nothing and silently starving that supplier of
-- every order.
--
-- Only the spellings actually observed or obviously likely are rewritten
-- here; anything else is left alone rather than guessed at, and will simply
-- fail to match until an operator fixes it in the admin panel. The general
-- resolver runs in application code from now on, so this is a one-off repair
-- of historical data, not an ongoing mechanism.

-- Split the one known multi-city row into proper separate service areas.
INSERT INTO "ServiceArea" ("id", "supplierId", "city")
SELECT gen_random_uuid(), "supplierId", 'Алматы'
FROM "ServiceArea"
WHERE lower(trim("city")) = 'астана алмата';

UPDATE "ServiceArea" SET "city" = 'Астана'
WHERE lower(trim("city")) = 'астана алмата';

-- Common alternate spellings, both tables.
UPDATE "ServiceArea" SET "city" = 'Астана'
WHERE lower(trim("city")) IN ('астана', 'нур-султан', 'нурсултан', 'нур султан', 'г. астана', 'целиноград');

UPDATE "ServiceArea" SET "city" = 'Алматы'
WHERE lower(trim("city")) IN ('алматы', 'алмата', 'алма-ата', 'алма ата', 'г. алматы');

UPDATE "ServiceArea" SET "city" = 'Шымкент'
WHERE lower(trim("city")) IN ('шымкент', 'чимкент');

UPDATE "ServiceArea" SET "city" = 'Караганда'
WHERE lower(trim("city")) IN ('караганда', 'қарағанды', 'карағанды');

UPDATE "Order" SET "city" = 'Астана'
WHERE lower(trim("city")) IN ('астана', 'нур-султан', 'нурсултан', 'нур султан', 'г. астана');

UPDATE "Order" SET "city" = 'Алматы'
WHERE lower(trim("city")) IN ('алматы', 'алмата', 'алма-ата', 'алма ата', 'г. алматы');

UPDATE "Order" SET "city" = 'Шымкент'
WHERE lower(trim("city")) IN ('шымкент', 'чимкент');

UPDATE "Order" SET "city" = 'Караганда'
WHERE lower(trim("city")) IN ('караганда', 'қарағанды', 'карағанды');
