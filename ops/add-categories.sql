-- Три новые категории: автовышка, фронтальный погрузчик, дезинфекция.
--
-- Справочник живёт в БД (Category, jsonb), а сид на проде не запускается —
-- он перезаписал бы поля, правленные скриптами trim-category-fields.sql и
-- remove-waste-type-field.sql. Поэтому здесь ровно те же три категории, что
-- в category-seed-data.ts, и ничего кроме них.
--
-- Файл сгенерирован из собранного кода, а не набран руками: описание
-- категории должно быть одно, иначе код и сервер разойдутся незаметно.
--
-- Повторный запуск безопасен: существующие строки не трогаются.
--
-- Запуск:
--   docker-compose -f docker-compose.prod.yml exec -T postgres \
--     psql -U app -d ai_zayavki -f - < ops/add-categories.sql

BEGIN;

-- Автовышка: 7 полей
INSERT INTO "Category" ("id", "slug", "name", "icon", "examples", "fields", "isActive", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'aerial-platform',
  '{"ru":"Автовышка","kk":"Автовышка"}',
  'crane-lift',
  '[{"ru":"Нужна автовышка обрезать деревья","kk":"Ағаш бұтау үшін автовышка керек"},{"ru":"Нужна вышка повесить вывеску на фасад","kk":"Қасбетке маңдайша ілу үшін вышка керек"}]',
  '[{"key":"city","label":{"ru":"Город","kk":"Қала"},"type":"text","required":true,"question":{"ru":"В каком городе нужна услуга?","kk":"Қызмет қай қалада керек?"}},{"key":"taskType","label":{"ru":"Вид работ","kk":"Жұмыс түрі"},"type":"enum","required":false,"options":[{"value":"trees","label":{"ru":"Обрезка деревьев","kk":"Ағаш бұтау"}},{"value":"signage","label":{"ru":"Вывеска, реклама","kk":"Маңдайша, жарнама"}},{"value":"lamps","label":{"ru":"Замена ламп, электрика","kk":"Шам ауыстыру, электрика"}},{"value":"facade","label":{"ru":"Фасадные работы","kk":"Қасбет жұмыстары"}},{"value":"other","label":{"ru":"Другое","kk":"Басқа"}}],"question":{"ru":"Что нужно сделать — обрезка деревьев, вывеска, замена ламп, фасад?","kk":"Не істеу керек — ағаш бұтау, маңдайша, шам ауыстыру, қасбет пе?"}},{"key":"height","label":{"ru":"Высота работ","kk":"Жұмыс биіктігі"},"type":"text","required":false,"allowUnknown":true,"question":{"ru":"На какой высоте работы — сколько этажей или метров?","kk":"Жұмыс қандай биіктікте — неше қабат немесе метр?"}},{"key":"date","label":{"ru":"Дата","kk":"Күні"},"type":"date","required":true,"question":{"ru":"На какую дату нужна автовышка?","kk":"Автовышка қай күнге керек?"}},{"key":"time","label":{"ru":"Время подачи","kk":"Беру уақыты"},"type":"time","required":false,"question":{"ru":"В какое время нужна машина?","kk":"Көлік қай уақытта керек?"}},{"key":"address","label":{"ru":"Адрес объекта","kk":"Нысан мекенжайы"},"type":"address","required":false,"question":{"ru":"Укажите адрес объекта.","kk":"Нысанның мекенжайын көрсетіңіз."}},{"key":"photos","label":{"ru":"Фотографии","kk":"Фотосуреттер"},"type":"photo","required":false,"question":{"ru":"Прикрепите фото объекта, если есть — так проще понять, какая вышка нужна.","kk":"Мүмкіндігінше нысан фотосуретін тіркеңіз — қандай вышка керегін түсіну оңай болады."}}]',
  true, now(), now()
)
ON CONFLICT ("slug") DO NOTHING;

-- Фронтальный погрузчик: 6 полей
INSERT INTO "Category" ("id", "slug", "name", "icon", "examples", "fields", "isActive", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'front-loader',
  '{"ru":"Фронтальный погрузчик","kk":"Фронтальды тиегіш"}',
  'loader',
  '[{"ru":"Нужен фронтальный погрузчик убрать снег во дворе","kk":"Аулада қар тазалауға фронтальды тиегіш керек"},{"ru":"Нужен погрузчик загрузить грунт в самосвал","kk":"Топырақты самосвалға тиеу үшін тиегіш керек"}]',
  '[{"key":"city","label":{"ru":"Город","kk":"Қала"},"type":"text","required":true,"question":{"ru":"В каком городе нужна услуга?","kk":"Қызмет қай қалада керек?"}},{"key":"taskType","label":{"ru":"Вид работ","kk":"Жұмыс түрі"},"type":"enum","required":false,"options":[{"value":"snow","label":{"ru":"Уборка снега","kk":"Қар тазалау"}},{"value":"loading","label":{"ru":"Погрузка грунта, сыпучих","kk":"Топырақ, сусымалы тиеу"}},{"value":"clearing","label":{"ru":"Расчистка, планировка площадки","kk":"Алаңды тазалау, тегістеу"}},{"value":"other","label":{"ru":"Другое","kk":"Басқа"}}],"question":{"ru":"Что нужно сделать — убрать снег, погрузить, расчистить площадку?","kk":"Не істеу керек — қар тазалау, тиеу, алаңды тазалау ма?"}},{"key":"date","label":{"ru":"Дата","kk":"Күні"},"type":"date","required":true,"question":{"ru":"На какую дату нужен погрузчик?","kk":"Тиегіш қай күнге керек?"}},{"key":"time","label":{"ru":"Время подачи","kk":"Беру уақыты"},"type":"time","required":false,"question":{"ru":"В какое время нужна машина?","kk":"Көлік қай уақытта керек?"}},{"key":"address","label":{"ru":"Адрес объекта","kk":"Нысан мекенжайы"},"type":"address","required":false,"question":{"ru":"Укажите адрес объекта.","kk":"Нысанның мекенжайын көрсетіңіз."}},{"key":"photos","label":{"ru":"Фотографии","kk":"Фотосуреттер"},"type":"photo","required":false,"question":{"ru":"Прикрепите фото участка, если есть.","kk":"Мүмкіндігінше учаске фотосуретін тіркеңіз."}}]',
  true, now(), now()
)
ON CONFLICT ("slug") DO NOTHING;

-- Дезинфекция: 6 полей
INSERT INTO "Category" ("id", "slug", "name", "icon", "examples", "fields", "isActive", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'disinfection',
  '{"ru":"Дезинфекция","kk":"Дезинфекция"}',
  'spray',
  '[{"ru":"Нужно потравить тараканов в квартире","kk":"Пәтерде тарақандарды улау керек"},{"ru":"Обработка помещения от клопов","kk":"Үй-жайды қандалалардан өңдеу"}]',
  '[{"key":"city","label":{"ru":"Город","kk":"Қала"},"type":"text","required":true,"question":{"ru":"В каком городе нужна услуга?","kk":"Қызмет қай қалада керек?"}},{"key":"pestType","label":{"ru":"От кого обработка","kk":"Неден өңдеу"},"type":"enum","required":false,"options":[{"value":"cockroaches","label":{"ru":"Тараканы","kk":"Тарақандар"}},{"value":"bedbugs","label":{"ru":"Клопы","kk":"Қандалалар"}},{"value":"rodents","label":{"ru":"Крысы, мыши","kk":"Егеуқұйрықтар, тышқандар"}},{"value":"mould","label":{"ru":"Плесень, запах","kk":"Зең, иіс"}},{"value":"other","label":{"ru":"Другое","kk":"Басқа"}}],"question":{"ru":"От кого нужна обработка — тараканы, клопы, грызуны?","kk":"Неден өңдеу керек — тарақандар, қандалалар, кеміргіштер бе?"}},{"key":"objectType","label":{"ru":"Помещение","kk":"Үй-жай"},"type":"enum","required":false,"options":[{"value":"flat","label":{"ru":"Квартира","kk":"Пәтер"}},{"value":"house","label":{"ru":"Дом","kk":"Үй"}},{"value":"office","label":{"ru":"Офис","kk":"Кеңсе"}},{"value":"food","label":{"ru":"Кафе, магазин","kk":"Дәмхана, дүкен"}},{"value":"other","label":{"ru":"Другое","kk":"Басқа"}}],"question":{"ru":"Что за помещение — квартира, дом, офис, кафе?","kk":"Қандай үй-жай — пәтер, үй, кеңсе, дәмхана ма?"}},{"key":"area","label":{"ru":"Площадь","kk":"Ауданы"},"type":"number","required":false,"unit":"м²","allowUnknown":true,"question":{"ru":"Какая площадь помещения?","kk":"Үй-жайдың ауданы қандай?"}},{"key":"date","label":{"ru":"Дата","kk":"Күні"},"type":"date","required":true,"question":{"ru":"На какую дату нужна обработка?","kk":"Өңдеу қай күнге керек?"}},{"key":"address","label":{"ru":"Адрес","kk":"Мекенжай"},"type":"address","required":false,"question":{"ru":"Укажите адрес.","kk":"Мекенжайды көрсетіңіз."}}]',
  true, now(), now()
)
ON CONFLICT ("slug") DO NOTHING;

-- Что получилось. Ожидаем девять строк, три последние — новые.
SELECT "slug", "name", "isActive", jsonb_array_length("fields") AS "полей"
FROM "Category"
ORDER BY "createdAt";

COMMIT;
