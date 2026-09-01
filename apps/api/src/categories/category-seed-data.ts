import { CategoryTemplate } from "@ai-zayavki/shared";

// The 5 MVP categories from ТЗ п.4/п.6. Admins can edit these later through
// the admin panel (they live in Category.fields as JSON) — this file only
// seeds the initial rows.
//
// Every user-facing string is bilingual ({ru, kk}) — see
// packages/shared/src/language.ts. The Kazakh text here is my own
// translation, not reviewed by a native speaker; worth a review pass before
// fully trusting it in production.
export const CATEGORY_SEED_DATA: CategoryTemplate[] = [
  {
    slug: "gazelle",
    name: { ru: "Газель", kk: "Газель" },
    icon: "truck",
    examples: [
      { ru: "Нужна газель перевезти вещи при переезде", kk: "Көшу кезінде заттарды тасымалдауға газель керек" },
      { ru: "Нужно перевезти мебель", kk: "Жиһазды тасымалдау керек" },
    ],
    fields: [
      {
        key: "city",
        label: { ru: "Город", kk: "Қала" },
        type: "text",
        required: true,
        question: { ru: "В каком городе нужна услуга?", kk: "Қызмет қай қалада керек?" },
      },
      {
        key: "date",
        label: { ru: "Дата", kk: "Күні" },
        type: "date",
        required: true,
        question: { ru: "На какую дату нужна газель?", kk: "Газель қай күнге керек?" },
      },
      {
        key: "time",
        label: { ru: "Время подачи", kk: "Беру уақыты" },
        type: "time",
        required: false,
        question: { ru: "В какое время нужна машина?", kk: "Көлік қай уақытта керек?" },
      },
      {
        key: "needLoaders",
        label: { ru: "Нужны грузчики", kk: "Тиеушілер керек пе" },
        type: "boolean",
        required: false,
        question: { ru: "Нужны ли грузчики для погрузки/разгрузки?", kk: "Тиеу/түсіру үшін тиеушілер керек пе?" },
      },
      {
        key: "addressFrom",
        label: { ru: "Адрес загрузки", kk: "Тиеу мекенжайы" },
        type: "address",
        required: false,
        question: {
          ru: "Укажите адрес загрузки и адрес выгрузки.",
          kk: "Тиеу мекенжайы мен түсіру мекенжайын көрсетіңіз.",
        },
        combineGroup: "addresses",
      },
      {
        key: "addressTo",
        label: { ru: "Адрес выгрузки", kk: "Түсіру мекенжайы" },
        type: "address",
        required: false,
        question: {
          ru: "Укажите адрес загрузки и адрес выгрузки.",
          kk: "Тиеу мекенжайы мен түсіру мекенжайын көрсетіңіз.",
        },
        combineGroup: "addresses",
      },
      {
        key: "photos",
        label: { ru: "Фотографии", kk: "Фотосуреттер" },
        type: "photo",
        required: false,
        question: {
          ru: "Прикрепите фото груза, если есть — так проще оценить объём.",
          kk: "Мүмкіндігінше жүктің фотосуретін тіркеңіз — көлемін бағалау оңай болады.",
        },
      },
    ],
  },
  {
    slug: "dump-truck",
    name: { ru: "Самосвал", kk: "Самосвал" },
    icon: "truck",
    examples: [
      { ru: "Нужен самосвал вывезти грунт", kk: "Топырақты шығару үшін самосвал керек" },
      { ru: "Требуется самосвал", kk: "Самосвал қажет" },
    ],
    fields: [
      {
        key: "city",
        label: { ru: "Город", kk: "Қала" },
        type: "text",
        required: true,
        question: { ru: "В каком городе нужна услуга?", kk: "Қызмет қай қалада керек?" },
      },
      {
        key: "cargoType",
        label: { ru: "Что везём", kk: "Жүк түрі" },
        type: "enum",
        required: false,
        options: [
          { value: "soil", label: { ru: "Грунт", kk: "Топырақ" } },
          { value: "sand", label: { ru: "Песок", kk: "Құм" } },
          { value: "gravel", label: { ru: "Щебень", kk: "Қиыршықтас" } },
          { value: "construction_debris", label: { ru: "Строительный мусор", kk: "Құрылыс қоқысы" } },
          { value: "other", label: { ru: "Другое", kk: "Басқа" } },
        ],
        question: {
          ru: "Что нужно перевезти — грунт, песок, щебень или строительный мусор?",
          kk: "Нені тасымалдау керек — топырақ, құм, қиыршықтас немесе құрылыс қоқысы ма?",
        },
      },
      {
        key: "date",
        label: { ru: "Дата", kk: "Күні" },
        type: "date",
        required: true,
        question: { ru: "На какую дату нужен самосвал?", kk: "Самосвал қай күнге керек?" },
      },
      {
        key: "time",
        label: { ru: "Время подачи", kk: "Беру уақыты" },
        type: "time",
        required: false,
        question: { ru: "В какое время подать машину?", kk: "Көлікті қай уақытта беру керек?" },
      },
      {
        key: "address",
        label: { ru: "Адрес", kk: "Мекенжай" },
        type: "address",
        required: false,
        question: { ru: "Укажите адрес, куда подать самосвал.", kk: "Самосвалды қай жерге беру керектігін көрсетіңіз." },
      },
      {
        key: "photos",
        label: { ru: "Фотографии", kk: "Фотосуреттер" },
        type: "photo",
        required: false,
        question: { ru: "Прикрепите фото, если есть.", kk: "Мүмкіндігінше фотосурет тіркеңіз." },
      },
    ],
  },
  {
    slug: "crane-truck",
    name: { ru: "Манипулятор", kk: "Манипулятор" },
    icon: "crane",
    examples: [
      { ru: "Нужен манипулятор на завтра", kk: "Ертеңге манипулятор керек" },
      {
        ru: "Завтра нужен манипулятор перевезти бытовку из Астаны в Косшы",
        kk: "Ертең манипулятор Астанадан Қосшыға вагон-үй тасымалдауы керек",
      },
    ],
    fields: [
      {
        key: "city",
        label: { ru: "Город", kk: "Қала" },
        type: "text",
        required: true,
        question: { ru: "В каком городе нужна услуга?", kk: "Қызмет қай қалада керек?" },
      },
      {
        key: "date",
        label: { ru: "Дата", kk: "Күні" },
        type: "date",
        required: true,
        question: { ru: "На какую дату нужен манипулятор?", kk: "Манипулятор қай күнге керек?" },
      },
      {
        key: "time",
        label: { ru: "Время подачи", kk: "Беру уақыты" },
        type: "time",
        required: false,
        question: { ru: "В какое время нужна машина?", kk: "Көлік қай уақытта керек?" },
      },
      {
        key: "addressFrom",
        label: { ru: "Адрес загрузки", kk: "Тиеу мекенжайы" },
        type: "address",
        required: false,
        // Both fields in a combineGroup share one question on purpose:
        // buildQuestionText de-duplicates, so the client reads a single
        // sentence instead of two commands stitched together.
        question: {
          ru: "Укажите адрес загрузки и адрес доставки.",
          kk: "Тиеу мекенжайы мен жеткізу мекенжайын көрсетіңіз.",
        },
        combineGroup: "addresses",
      },
      {
        key: "addressTo",
        label: { ru: "Адрес назначения", kk: "Межелі мекенжай" },
        type: "address",
        required: false,
        question: {
          ru: "Укажите адрес загрузки и адрес доставки.",
          kk: "Тиеу мекенжайы мен жеткізу мекенжайын көрсетіңіз.",
        },
        combineGroup: "addresses",
      },
      {
        key: "photos",
        label: { ru: "Фотографии", kk: "Фотосуреттер" },
        type: "photo",
        required: false,
        question: { ru: "Прикрепите фото груза, если есть.", kk: "Мүмкіндігінше жүктің фотосуретін тіркеңіз." },
      },
    ],
  },
  {
    slug: "crane",
    name: { ru: "Автокран", kk: "Автокран" },
    icon: "crane-lift",
    examples: [
      { ru: "Нужен кран поднять груз", kk: "Жүкті көтеру үшін кран керек" },
      { ru: "Нужен автокран для монтажа", kk: "Монтаж үшін автокран керек" },
    ],
    fields: [
      {
        key: "city",
        label: { ru: "Город", kk: "Қала" },
        type: "text",
        required: true,
        question: { ru: "В каком городе нужна услуга?", kk: "Қызмет қай қалада керек?" },
      },
      {
        key: "taskType",
        label: { ru: "Вид работ", kk: "Жұмыс түрі" },
        type: "enum",
        required: false,
        options: [
          { value: "lifting", label: { ru: "Подъём груза", kk: "Жүк көтеру" } },
          { value: "installation", label: { ru: "Монтаж конструкций", kk: "Конструкцияларды монтаждау" } },
          { value: "dismantling", label: { ru: "Демонтаж", kk: "Демонтаж" } },
          { value: "other", label: { ru: "Другое", kk: "Басқа" } },
        ],
        question: {
          ru: "Какие нужны работы — подъём груза, монтаж, демонтаж?",
          kk: "Қандай жұмыс керек — жүк көтеру, монтаж, демонтаж ба?",
        },
      },
      {
        key: "date",
        label: { ru: "Дата", kk: "Күні" },
        type: "date",
        required: true,
        question: { ru: "На какую дату нужен кран?", kk: "Кран қай күнге керек?" },
      },
      {
        key: "time",
        label: { ru: "Время подачи", kk: "Беру уақыты" },
        type: "time",
        required: false,
        question: { ru: "В какое время нужен кран?", kk: "Кран қай уақытта керек?" },
      },
      {
        key: "address",
        label: { ru: "Адрес объекта", kk: "Нысан мекенжайы" },
        type: "address",
        required: false,
        question: { ru: "Укажите адрес объекта, куда подать кран.", kk: "Кранды беру керек нысанның мекенжайын көрсетіңіз." },
      },
      {
        key: "photos",
        label: { ru: "Фотографии", kk: "Фотосуреттер" },
        type: "photo",
        required: false,
        question: {
          ru: "Прикрепите фото объекта или груза, если есть.",
          kk: "Мүмкіндігінше нысан немесе жүк фотосуретін тіркеңіз.",
        },
      },
    ],
  },
  {
    slug: "construction-waste",
    name: { ru: "Вывоз строительного мусора", kk: "Құрылыс қоқысын шығару" },
    icon: "trash",
    examples: [{ ru: "Нужно вывезти строительный мусор", kk: "Құрылыс қоқысын шығару керек" }],
    fields: [
      {
        key: "city",
        label: { ru: "Город", kk: "Қала" },
        type: "text",
        required: true,
        question: { ru: "В каком городе нужна услуга?", kk: "Қызмет қай қалада керек?" },
      },
      {
        key: "needLoaders",
        label: { ru: "Нужны грузчики", kk: "Тиеушілер керек пе" },
        type: "boolean",
        required: false,
        question: { ru: "Нужны ли грузчики для погрузки?", kk: "Тиеу үшін тиеушілер керек пе?" },
      },
      {
        key: "date",
        label: { ru: "Дата", kk: "Күні" },
        type: "date",
        required: true,
        question: { ru: "На какую дату нужен вывоз?", kk: "Шығару қай күнге керек?" },
      },
      {
        key: "time",
        label: { ru: "Время", kk: "Уақыт" },
        type: "time",
        required: false,
        question: { ru: "В какое время удобно?", kk: "Қай уақыт ыңғайлы?" },
      },
      {
        key: "address",
        label: { ru: "Адрес", kk: "Мекенжай" },
        type: "address",
        required: false,
        question: { ru: "Укажите адрес, откуда вывозить мусор.", kk: "Қоқысты шығару керек мекенжайды көрсетіңіз." },
      },
      {
        key: "photos",
        label: { ru: "Фотографии", kk: "Фотосуреттер" },
        type: "photo",
        required: false,
        question: { ru: "Прикрепите фото мусора, если есть.", kk: "Мүмкіндігінше қоқыс фотосуретін тіркеңіз." },
      },
    ],
  },
  {
    slug: "loaders",
    name: { ru: "Грузчики", kk: "Тиеушілер" },
    icon: "people",
    examples: [{ ru: "Нужны грузчики", kk: "Тиеушілер керек" }],
    fields: [
      {
        key: "city",
        label: { ru: "Город", kk: "Қала" },
        type: "text",
        required: true,
        question: { ru: "В каком городе нужна услуга?", kk: "Қызмет қай қалада керек?" },
      },
      {
        key: "workType",
        label: { ru: "Вид работы", kk: "Жұмыс түрі" },
        type: "enum",
        required: false,
        options: [
          { value: "loading", label: { ru: "Погрузка", kk: "Тиеу" } },
          { value: "unloading", label: { ru: "Разгрузка", kk: "Түсіру" } },
          { value: "moving", label: { ru: "Переезд", kk: "Көшу" } },
          { value: "floor_lift", label: { ru: "Подъём на этаж", kk: "Қабатқа көтеру" } },
        ],
        question: {
          ru: "Какая нужна работа — погрузка, разгрузка, переезд или подъём на этаж?",
          kk: "Қандай жұмыс керек — тиеу, түсіру, көшу немесе қабатқа көтеру ме?",
        },
      },
      {
        key: "numberOfLoaders",
        label: { ru: "Количество грузчиков", kk: "Тиеушілер саны" },
        type: "number",
        required: false,
        allowUnknown: true,
        question: { ru: "Сколько нужно грузчиков?", kk: "Неше тиеуші керек?" },
      },
      {
        key: "floor",
        label: { ru: "Этаж", kk: "Қабат" },
        type: "number",
        required: false,
        allowUnknown: true,
        question: { ru: "Какой этаж и есть ли лифт?", kk: "Қай қабат және лифт бар ма?" },
        combineGroup: "floor",
      },
      {
        key: "hasElevator",
        label: { ru: "Есть лифт", kk: "Лифт бар" },
        type: "boolean",
        required: false,
        question: { ru: "Есть ли лифт в здании?", kk: "Ғимаратта лифт бар ма?" },
        combineGroup: "floor",
      },
      {
        key: "date",
        label: { ru: "Дата", kk: "Күні" },
        type: "date",
        required: true,
        question: { ru: "На какую дату нужны грузчики?", kk: "Тиеушілер қай күнге керек?" },
      },
      {
        key: "time",
        label: { ru: "Время", kk: "Уақыт" },
        type: "time",
        required: false,
        question: { ru: "К какому времени?", kk: "Қай уақытқа дейін?" },
      },
      {
        key: "address",
        label: { ru: "Адрес", kk: "Мекенжай" },
        type: "address",
        required: false,
        question: { ru: "Укажите адрес.", kk: "Мекенжайды көрсетіңіз." },
      },
    ],
  },
  // Три категории добавлены 2 сентября по спросу, которого нам не хватило.
  //
  // Автовышку и фронтальный погрузчик спрашивали клиенты, дезинфекцию —
  // исполнители при регистрации. Заявка без категории уходит в разбор руками,
  // а исполнителю по такой услуге просто некуда записаться.
  //
  // Полей намеренно мало: разбор от 29 августа (ops/trim-category-fields.sql)
  // показал, что вопрос, ответа на который клиент не знает, стоит заявки.
  // Спрашиваем то, что человек назовёт не задумываясь, остальное исполнитель
  // выяснит по телефону.
  {
    slug: "aerial-platform",
    name: { ru: "Автовышка", kk: "Автовышка" },
    icon: "crane-lift",
    examples: [
      { ru: "Нужна автовышка обрезать деревья", kk: "Ағаш бұтау үшін автовышка керек" },
      { ru: "Нужна вышка повесить вывеску на фасад", kk: "Қасбетке маңдайша ілу үшін вышка керек" },
    ],
    fields: [
      {
        key: "city",
        label: { ru: "Город", kk: "Қала" },
        type: "text",
        required: true,
        question: { ru: "В каком городе нужна услуга?", kk: "Қызмет қай қалада керек?" },
      },
      {
        key: "taskType",
        label: { ru: "Вид работ", kk: "Жұмыс түрі" },
        type: "enum",
        required: false,
        options: [
          { value: "trees", label: { ru: "Обрезка деревьев", kk: "Ағаш бұтау" } },
          { value: "signage", label: { ru: "Вывеска, реклама", kk: "Маңдайша, жарнама" } },
          { value: "lamps", label: { ru: "Замена ламп, электрика", kk: "Шам ауыстыру, электрика" } },
          { value: "facade", label: { ru: "Фасадные работы", kk: "Қасбет жұмыстары" } },
          { value: "other", label: { ru: "Другое", kk: "Басқа" } },
        ],
        question: {
          ru: "Что нужно сделать — обрезка деревьев, вывеска, замена ламп, фасад?",
          kk: "Не істеу керек — ағаш бұтау, маңдайша, шам ауыстыру, қасбет пе?",
        },
      },
      {
        // Высоту спрашиваем, хотя лишних вопросов не задаём: от неё зависит,
        // какая машина поедет — 14, 18 или 22 метра. Человек отвечает
        // этажами, и этого достаточно, поэтому и спрашиваем про этажи.
        key: "height",
        label: { ru: "Высота работ", kk: "Жұмыс биіктігі" },
        type: "text",
        required: false,
        allowUnknown: true,
        question: {
          ru: "На какой высоте работы — сколько этажей или метров?",
          kk: "Жұмыс қандай биіктікте — неше қабат немесе метр?",
        },
      },
      {
        key: "date",
        label: { ru: "Дата", kk: "Күні" },
        type: "date",
        required: true,
        question: { ru: "На какую дату нужна автовышка?", kk: "Автовышка қай күнге керек?" },
      },
      {
        key: "time",
        label: { ru: "Время подачи", kk: "Беру уақыты" },
        type: "time",
        required: false,
        question: { ru: "В какое время нужна машина?", kk: "Көлік қай уақытта керек?" },
      },
      {
        key: "address",
        label: { ru: "Адрес объекта", kk: "Нысан мекенжайы" },
        type: "address",
        required: false,
        question: { ru: "Укажите адрес объекта.", kk: "Нысанның мекенжайын көрсетіңіз." },
      },
      {
        key: "photos",
        label: { ru: "Фотографии", kk: "Фотосуреттер" },
        type: "photo",
        required: false,
        question: {
          ru: "Прикрепите фото объекта, если есть — так проще понять, какая вышка нужна.",
          kk: "Мүмкіндігінше нысан фотосуретін тіркеңіз — қандай вышка керегін түсіну оңай болады.",
        },
      },
    ],
  },
  {
    slug: "front-loader",
    name: { ru: "Фронтальный погрузчик", kk: "Фронтальды тиегіш" },
    icon: "loader",
    examples: [
      { ru: "Нужен фронтальный погрузчик убрать снег во дворе", kk: "Аулада қар тазалауға фронтальды тиегіш керек" },
      { ru: "Нужен погрузчик загрузить грунт в самосвал", kk: "Топырақты самосвалға тиеу үшін тиегіш керек" },
    ],
    fields: [
      {
        key: "city",
        label: { ru: "Город", kk: "Қала" },
        type: "text",
        required: true,
        question: { ru: "В каком городе нужна услуга?", kk: "Қызмет қай қалада керек?" },
      },
      {
        key: "taskType",
        label: { ru: "Вид работ", kk: "Жұмыс түрі" },
        type: "enum",
        required: false,
        options: [
          { value: "snow", label: { ru: "Уборка снега", kk: "Қар тазалау" } },
          { value: "loading", label: { ru: "Погрузка грунта, сыпучих", kk: "Топырақ, сусымалы тиеу" } },
          { value: "clearing", label: { ru: "Расчистка, планировка площадки", kk: "Алаңды тазалау, тегістеу" } },
          { value: "other", label: { ru: "Другое", kk: "Басқа" } },
        ],
        question: {
          ru: "Что нужно сделать — убрать снег, погрузить, расчистить площадку?",
          kk: "Не істеу керек — қар тазалау, тиеу, алаңды тазалау ма?",
        },
      },
      {
        key: "date",
        label: { ru: "Дата", kk: "Күні" },
        type: "date",
        required: true,
        question: { ru: "На какую дату нужен погрузчик?", kk: "Тиегіш қай күнге керек?" },
      },
      {
        key: "time",
        label: { ru: "Время подачи", kk: "Беру уақыты" },
        type: "time",
        required: false,
        question: { ru: "В какое время нужна машина?", kk: "Көлік қай уақытта керек?" },
      },
      {
        key: "address",
        label: { ru: "Адрес объекта", kk: "Нысан мекенжайы" },
        type: "address",
        required: false,
        question: { ru: "Укажите адрес объекта.", kk: "Нысанның мекенжайын көрсетіңіз." },
      },
      {
        key: "photos",
        label: { ru: "Фотографии", kk: "Фотосуреттер" },
        type: "photo",
        required: false,
        question: {
          ru: "Прикрепите фото участка, если есть.",
          kk: "Мүмкіндігінше учаске фотосуретін тіркеңіз.",
        },
      },
    ],
  },
  {
    // Дезинфекция, дезинсекция и дератизация — так по-разному называется
    // работа с вирусами, насекомыми и грызунами, но клиент почти всегда
    // пишет «дезинфекция» или прямо «потравить тараканов». Держим одну
    // категорию, а что именно травить — спрашиваем полем: делить на три
    // значило бы требовать от человека знания, которого у него нет.
    slug: "disinfection",
    name: { ru: "Дезинфекция", kk: "Дезинфекция" },
    icon: "spray",
    examples: [
      { ru: "Нужно потравить тараканов в квартире", kk: "Пәтерде тарақандарды улау керек" },
      { ru: "Обработка помещения от клопов", kk: "Үй-жайды қандалалардан өңдеу" },
    ],
    fields: [
      {
        key: "city",
        label: { ru: "Город", kk: "Қала" },
        type: "text",
        required: true,
        question: { ru: "В каком городе нужна услуга?", kk: "Қызмет қай қалада керек?" },
      },
      {
        key: "pestType",
        label: { ru: "От кого обработка", kk: "Неден өңдеу" },
        type: "enum",
        required: false,
        options: [
          { value: "cockroaches", label: { ru: "Тараканы", kk: "Тарақандар" } },
          { value: "bedbugs", label: { ru: "Клопы", kk: "Қандалалар" } },
          { value: "rodents", label: { ru: "Крысы, мыши", kk: "Егеуқұйрықтар, тышқандар" } },
          { value: "mould", label: { ru: "Плесень, запах", kk: "Зең, иіс" } },
          { value: "other", label: { ru: "Другое", kk: "Басқа" } },
        ],
        question: {
          ru: "От кого нужна обработка — тараканы, клопы, грызуны?",
          kk: "Неден өңдеу керек — тарақандар, қандалалар, кеміргіштер бе?",
        },
      },
      {
        key: "objectType",
        label: { ru: "Помещение", kk: "Үй-жай" },
        type: "enum",
        required: false,
        options: [
          { value: "flat", label: { ru: "Квартира", kk: "Пәтер" } },
          { value: "house", label: { ru: "Дом", kk: "Үй" } },
          { value: "office", label: { ru: "Офис", kk: "Кеңсе" } },
          { value: "food", label: { ru: "Кафе, магазин", kk: "Дәмхана, дүкен" } },
          { value: "other", label: { ru: "Другое", kk: "Басқа" } },
        ],
        question: {
          ru: "Что за помещение — квартира, дом, офис, кафе?",
          kk: "Қандай үй-жай — пәтер, үй, кеңсе, дәмхана ма?",
        },
      },
      {
        // Единственное число, которое человек знает про своё жильё наизусть.
        key: "area",
        label: { ru: "Площадь", kk: "Ауданы" },
        type: "number",
        required: false,
        unit: "м²",
        allowUnknown: true,
        question: { ru: "Какая площадь помещения?", kk: "Үй-жайдың ауданы қандай?" },
      },
      {
        key: "date",
        label: { ru: "Дата", kk: "Күні" },
        type: "date",
        required: true,
        question: { ru: "На какую дату нужна обработка?", kk: "Өңдеу қай күнге керек?" },
      },
      {
        key: "address",
        label: { ru: "Адрес", kk: "Мекенжай" },
        type: "address",
        required: false,
        question: { ru: "Укажите адрес.", kk: "Мекенжайды көрсетіңіз." },
      },
    ],
  },
];
