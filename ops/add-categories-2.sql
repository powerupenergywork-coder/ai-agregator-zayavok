-- Четыре новые категории: электрик, сантехник, уборка, эвакуатор.
--
-- Справочник живёт в БД (Category, jsonb), а сид на проде не запускается —
-- он перезаписал бы поля, правленные скриптами trim-category-fields.sql и
-- remove-waste-type-field.sql. Поэтому здесь ровно те же четыре категории, что
-- в category-seed-data.ts, и ничего кроме них.
--
-- Файл сгенерирован из собранного кода, а не набран руками: описание
-- категории должно быть одно, иначе код и сервер разойдутся незаметно.
--
-- Повторный запуск безопасен: существующие строки не трогаются.
--
-- Запуск:
--   docker-compose -f docker-compose.prod.yml exec -T postgres \
--     psql -U app -d ai_zayavki -f - < ops/add-categories-2.sql

BEGIN;

-- Электрик: 5 полей
INSERT INTO "Category" ("id", "slug", "name", "icon", "examples", "fields", "isActive", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'electrician',
  '{"ru":"Электрик","kk":"Электрик"}',
  'bolt',
  '[{"ru":"Нужен электрик поменять розетки","kk":"Розеткаларды ауыстыруға электрик керек"},{"ru":"Не работает свет в квартире","kk":"Пәтерде жарық жоқ"}]',
  '[{"key":"city","label":{"ru":"Город","kk":"Қала"},"type":"text","required":true,"question":{"ru":"В каком городе нужна услуга?","kk":"Қызмет қай қалада керек?"}},{"key":"taskType","label":{"ru":"Что нужно сделать","kk":"Не істеу керек"},"type":"enum","required":false,"options":[{"value":"sockets","label":{"ru":"Розетки, выключатели","kk":"Розеткалар, ажыратқыштар"}},{"value":"wiring","label":{"ru":"Проводка","kk":"Сым тарту"}},{"value":"panel","label":{"ru":"Щиток, автоматы","kk":"Қалқан, автоматтар"}},{"value":"light","label":{"ru":"Свет, люстра","kk":"Жарық, люстра"}},{"value":"other","label":{"ru":"Другое","kk":"Басқа"}}],"question":{"ru":"Что нужно — розетки, проводка, щиток, свет?","kk":"Не керек — розеткалар, сым тарту, қалқан, жарық па?"}},{"key":"date","label":{"ru":"Дата","kk":"Күні"},"type":"date","required":true,"question":{"ru":"На какую дату нужен электрик?","kk":"Электрик қай күнге керек?"}},{"key":"address","label":{"ru":"Адрес","kk":"Мекенжай"},"type":"address","required":false,"question":{"ru":"Укажите адрес.","kk":"Мекенжайды көрсетіңіз."}},{"key":"photos","label":{"ru":"Фотографии","kk":"Фотосуреттер"},"type":"photo","required":false,"question":{"ru":"Прикрепите фото, если есть — по нему часто видно объём работы.","kk":"Мүмкіндігінше фото тіркеңіз — жұмыс көлемі көбіне содан көрінеді."}}]',
  true, now(), now()
)
ON CONFLICT ("slug") DO NOTHING;

-- Сантехник: 5 полей
INSERT INTO "Category" ("id", "slug", "name", "icon", "examples", "fields", "isActive", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'plumber',
  '{"ru":"Сантехник","kk":"Сантехник"}',
  'pipe',
  '[{"ru":"Нужен сантехник, течёт кран","kk":"Сантехник керек, кран ағып тұр"},{"ru":"Засор в трубе на кухне","kk":"Ас үйде құбыр бітеліп қалды"}]',
  '[{"key":"city","label":{"ru":"Город","kk":"Қала"},"type":"text","required":true,"question":{"ru":"В каком городе нужна услуга?","kk":"Қызмет қай қалада керек?"}},{"key":"taskType","label":{"ru":"Что нужно сделать","kk":"Не істеу керек"},"type":"enum","required":false,"options":[{"value":"leak","label":{"ru":"Течь, протечка","kk":"Ағу, су ағуы"}},{"value":"clog","label":{"ru":"Засор","kk":"Бітелу"}},{"value":"install","label":{"ru":"Установка сантехники","kk":"Сантехника орнату"}},{"value":"pipes","label":{"ru":"Замена труб","kk":"Құбыр ауыстыру"}},{"value":"other","label":{"ru":"Другое","kk":"Басқа"}}],"question":{"ru":"Что случилось — течь, засор, установка, замена труб?","kk":"Не болды — ағу, бітелу, орнату, құбыр ауыстыру ма?"}},{"key":"date","label":{"ru":"Дата","kk":"Күні"},"type":"date","required":true,"question":{"ru":"На какую дату нужен сантехник?","kk":"Сантехник қай күнге керек?"}},{"key":"address","label":{"ru":"Адрес","kk":"Мекенжай"},"type":"address","required":false,"question":{"ru":"Укажите адрес.","kk":"Мекенжайды көрсетіңіз."}},{"key":"photos","label":{"ru":"Фотографии","kk":"Фотосуреттер"},"type":"photo","required":false,"question":{"ru":"Прикрепите фото, если есть — так мастер сразу возьмёт нужные детали.","kk":"Мүмкіндігінше фото тіркеңіз — шебер керек бөлшектерді бірден алады."}}]',
  true, now(), now()
)
ON CONFLICT ("slug") DO NOTHING;

-- Уборка, клининг: 5 полей
INSERT INTO "Category" ("id", "slug", "name", "icon", "examples", "fields", "isActive", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'cleaning',
  '{"ru":"Уборка, клининг","kk":"Тазалау, клининг"}',
  'broom',
  '[{"ru":"Нужна уборка квартиры после ремонта","kk":"Жөндеуден кейін пәтерді тазалау керек"},{"ru":"Помыть окна в офисе","kk":"Кеңседе терезе жуу керек"}]',
  '[{"key":"city","label":{"ru":"Город","kk":"Қала"},"type":"text","required":true,"question":{"ru":"В каком городе нужна услуга?","kk":"Қызмет қай қалада керек?"}},{"key":"objectType","label":{"ru":"Что убираем","kk":"Нені тазалаймыз"},"type":"enum","required":false,"options":[{"value":"flat","label":{"ru":"Квартира","kk":"Пәтер"}},{"value":"house","label":{"ru":"Дом","kk":"Үй"}},{"value":"office","label":{"ru":"Офис","kk":"Кеңсе"}},{"value":"after_repair","label":{"ru":"После ремонта","kk":"Жөндеуден кейін"}},{"value":"windows","label":{"ru":"Только окна","kk":"Тек терезелер"}}],"question":{"ru":"Что убираем — квартиру, дом, офис, после ремонта?","kk":"Нені тазалаймыз — пәтер, үй, кеңсе, жөндеуден кейін бе?"}},{"key":"area","label":{"ru":"Площадь","kk":"Ауданы"},"type":"number","required":false,"unit":"м²","allowUnknown":true,"question":{"ru":"Какая площадь помещения?","kk":"Үй-жайдың ауданы қандай?"}},{"key":"date","label":{"ru":"Дата","kk":"Күні"},"type":"date","required":true,"question":{"ru":"На какую дату нужна уборка?","kk":"Тазалау қай күнге керек?"}},{"key":"address","label":{"ru":"Адрес","kk":"Мекенжай"},"type":"address","required":false,"question":{"ru":"Укажите адрес.","kk":"Мекенжайды көрсетіңіз."}}]',
  true, now(), now()
)
ON CONFLICT ("slug") DO NOTHING;

-- Эвакуатор: 6 полей
INSERT INTO "Category" ("id", "slug", "name", "icon", "examples", "fields", "isActive", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'tow-truck',
  '{"ru":"Эвакуатор","kk":"Эвакуатор"}',
  'tow',
  '[{"ru":"Нужен эвакуатор, машина не заводится","kk":"Эвакуатор керек, көлік от алмай тұр"},{"ru":"Отвезти машину в сервис","kk":"Көлікті сервиске жеткізу керек"}]',
  '[{"key":"city","label":{"ru":"Город","kk":"Қала"},"type":"text","required":true,"question":{"ru":"В каком городе нужна услуга?","kk":"Қызмет қай қалада керек?"}},{"key":"carType","label":{"ru":"Что везём","kk":"Нені тасымалдаймыз"},"type":"enum","required":false,"options":[{"value":"sedan","label":{"ru":"Легковая","kk":"Жеңіл көлік"}},{"value":"suv","label":{"ru":"Кроссовер, внедорожник","kk":"Кроссовер, жол талғамайтын"}},{"value":"van","label":{"ru":"Микроавтобус, газель","kk":"Шағын автобус, газель"}},{"value":"truck","label":{"ru":"Грузовая","kk":"Жүк көлігі"}},{"value":"moto","label":{"ru":"Мотоцикл","kk":"Мотоцикл"}}],"question":{"ru":"Что за машина — легковая, кроссовер, грузовая?","kk":"Қандай көлік — жеңіл, кроссовер, жүк көлігі ме?"}},{"key":"addressFrom","label":{"ru":"Откуда забрать","kk":"Қайдан алу керек"},"type":"address","required":false,"question":{"ru":"Откуда забрать машину и куда отвезти?","kk":"Көлікті қайдан алып, қайда жеткізу керек?"},"combineGroup":"addresses"},{"key":"addressTo","label":{"ru":"Куда отвезти","kk":"Қайда жеткізу керек"},"type":"address","required":false,"question":{"ru":"Откуда забрать машину и куда отвезти?","kk":"Көлікті қайдан алып, қайда жеткізу керек?"},"combineGroup":"addresses"},{"key":"date","label":{"ru":"Дата","kk":"Күні"},"type":"date","required":true,"question":{"ru":"На какую дату нужен эвакуатор?","kk":"Эвакуатор қай күнге керек?"}},{"key":"photos","label":{"ru":"Фотографии","kk":"Фотосуреттер"},"type":"photo","required":false,"question":{"ru":"Прикрепите фото машины и места, если есть.","kk":"Мүмкіндігінше көлік пен тұрған жердің фотосын тіркеңіз."}}]',
  true, now(), now()
)
ON CONFLICT ("slug") DO NOTHING;

-- Что получилось. Ожидаем тринадцать строк, четыре последние — новые.
SELECT "slug", "name", "isActive", jsonb_array_length("fields") AS "полей"
FROM "Category"
ORDER BY "createdAt";

COMMIT;
