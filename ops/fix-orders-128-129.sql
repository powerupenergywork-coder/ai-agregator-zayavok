-- Разовая правка исхода по заявкам №128 и №129.
--
-- Обе — состоявшиеся сделки, записанные как неудачи. Исполнителям НИЧЕГО не
-- отправляется: они уже получили сообщение о закрытии заявки, второе письмо о
-- той же заявке им ничего не даёт, а рейтинг номера тратит. Поэтому правка
-- идёт SQL-ом мимо сервиса, а не через API.
--
-- №128: клиент получил исполнителя через нас, но нажал «Закрыть заявку» —
-- в коде это означало отмену, и десяти исполнителям ушло «заявка отменена».
-- Кнопки с тех пор переименованы (completion_checkin_v3), но запись осталась.
--
-- №129: клиент нажал «Нашёл сам», через несколько секунд поправился на
-- «Нашёл через вас». Первое нажатие записалось, второе упёрлось в «завершить
-- можно только активную заявку». Починено в reviseOutcome, но задним числом
-- не пересчитывается.
--
-- История статусов пополняется записью с actor='manual-fix': переписывать
-- прошлое молча нельзя, иначе через месяц никто не поймёт, откуда расхождение
-- с журналом уведомлений.

BEGIN;

-- ── №128: отменена → выполнена через нас ────────────────────────────────────
INSERT INTO "OrderStatusEvent" (id, "orderId", "fromStatus", "toStatus", actor, note)
SELECT gen_random_uuid(), id, status, 'COMPLETED', 'manual-fix',
       'Клиент получил исполнителя через нас, но закрыл заявку кнопкой, которая означала отмену'
FROM "Order" WHERE number = 128 AND status = 'CANCELLED_BY_CLIENT';

UPDATE "Order"
SET status = 'COMPLETED',
    "clientRatingPositive" = true,
    "completedAt" = COALESCE("completedAt", "cancelledAt"),
    "cancelledAt" = NULL,
    "cancelReason" = NULL
WHERE number = 128 AND status = 'CANCELLED_BY_CLIENT';

-- ── №129: выполнена, но атрибуция «нашёл сам» → «через нас» ─────────────────
INSERT INTO "OrderStatusEvent" (id, "orderId", "fromStatus", "toStatus", actor, note)
SELECT gen_random_uuid(), id, status, status, 'manual-fix',
       'Атрибуция исправлена на «нашёл через нас» — второе нажатие клиента система отвергла'
FROM "Order" WHERE number = 129 AND "clientRatingPositive" IS NULL;

UPDATE "Order"
SET "clientRatingPositive" = true
WHERE number = 129 AND status = 'COMPLETED' AND "clientRatingPositive" IS NULL;

-- ── Проверка ────────────────────────────────────────────────────────────────
SELECT number, status, "clientRatingPositive" AS via_us, "completedAt", "cancelledAt"
FROM "Order" WHERE number IN (128, 129) ORDER BY number;

COMMIT;
