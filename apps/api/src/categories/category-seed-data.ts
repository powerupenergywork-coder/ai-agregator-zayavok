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
        combineGroup: "when",
        label: { ru: "Дата", kk: "Күні" },
        type: "date",
        required: true,
        question: { ru: "На какую дату нужна газель?", kk: "Газель қай күнге керек?" },
      },
      {
        key: "time",
        combineGroup: "when",
        label: { ru: "Время подачи", kk: "Беру уақыты" },
        type: "time",
        required: true,
        question: { ru: "В какое время нужна машина?", kk: "Көлік қай уақытта керек?" },
      },
      {
        key: "weightKg",
        label: { ru: "Вес груза", kk: "Жүк салмағы" },
        type: "number",
        unit: "кг",
        required: false,
        allowUnknown: true,
        question: { ru: "Какой примерный вес груза?", kk: "Жүктің шамамен салмағы қандай?" },
      },
      {
        key: "volumeM3",
        label: { ru: "Объём груза", kk: "Жүк көлемі" },
        type: "number",
        unit: "м³",
        required: false,
        allowUnknown: true,
        question: {
          ru: "Какой объём груза (в кубах или на глаз)?",
          kk: "Жүк көлемі қандай (текше метрмен немесе шамамен)?",
        },
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
        required: true,
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
        required: true,
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
        required: true,
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
        key: "volumeM3",
        label: { ru: "Объём", kk: "Көлемі" },
        type: "number",
        unit: "м³",
        required: false,
        allowUnknown: true,
        question: {
          ru: "Какой объём (в кубах или количество ходок)?",
          kk: "Көлемі қандай (текше метрмен немесе рейс саны)?",
        },
      },
      {
        key: "date",
        combineGroup: "when",
        label: { ru: "Дата", kk: "Күні" },
        type: "date",
        required: true,
        question: { ru: "На какую дату нужен самосвал?", kk: "Самосвал қай күнге керек?" },
      },
      {
        key: "time",
        combineGroup: "when",
        label: { ru: "Время подачи", kk: "Беру уақыты" },
        type: "time",
        required: true,
        question: { ru: "В какое время подать машину?", kk: "Көлікті қай уақытта беру керек?" },
      },
      {
        key: "address",
        label: { ru: "Адрес", kk: "Мекенжай" },
        type: "address",
        required: true,
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
        key: "weightTons",
        label: { ru: "Вес груза", kk: "Жүк салмағы" },
        type: "number",
        unit: "т",
        required: false,
        allowUnknown: true,
        question: {
          ru: "Какой примерный вес груза (в тоннах)?",
          kk: "Жүктің шамамен салмағы қанша тонна?",
        },
      },
      {
        key: "dimensions",
        label: { ru: "Размеры груза", kk: "Жүк өлшемдері" },
        type: "text",
        required: false,
        allowUnknown: true,
        question: { ru: "Какие размеры груза?", kk: "Жүктің өлшемдері қандай?" },
      },
      {
        key: "date",
        combineGroup: "when",
        label: { ru: "Дата", kk: "Күні" },
        type: "date",
        required: true,
        question: { ru: "На какую дату нужен манипулятор?", kk: "Манипулятор қай күнге керек?" },
      },
      {
        key: "time",
        combineGroup: "when",
        label: { ru: "Время подачи", kk: "Беру уақыты" },
        type: "time",
        required: true,
        question: { ru: "В какое время нужна машина?", kk: "Көлік қай уақытта керек?" },
      },
      {
        key: "addressFrom",
        label: { ru: "Адрес загрузки", kk: "Тиеу мекенжайы" },
        type: "address",
        required: true,
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
        required: true,
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
        required: true,
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
        key: "liftWeightTons",
        label: { ru: "Вес груза", kk: "Жүк салмағы" },
        type: "number",
        unit: "т",
        required: false,
        allowUnknown: true,
        question: {
          ru: "Какой примерный вес груза для подъёма (в тоннах)?",
          kk: "Көтерілетін жүктің шамамен салмағы қанша тонна?",
        },
      },
      {
        key: "liftHeightM",
        label: { ru: "Высота/вылет", kk: "Биіктігі/жету қашықтығы" },
        type: "number",
        unit: "м",
        required: false,
        allowUnknown: true,
        question: {
          ru: "На какую высоту или вылет стрелы нужно поднять груз?",
          kk: "Жүкті қандай биіктікке немесе кранның қай қашықтығына көтеру керек?",
        },
      },
      {
        key: "date",
        combineGroup: "when",
        label: { ru: "Дата", kk: "Күні" },
        type: "date",
        required: true,
        question: { ru: "На какую дату нужен кран?", kk: "Кран қай күнге керек?" },
      },
      {
        key: "time",
        combineGroup: "when",
        label: { ru: "Время подачи", kk: "Беру уақыты" },
        type: "time",
        required: true,
        question: { ru: "В какое время нужен кран?", kk: "Кран қай уақытта керек?" },
      },
      {
        key: "address",
        label: { ru: "Адрес объекта", kk: "Нысан мекенжайы" },
        type: "address",
        required: true,
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
        key: "wasteType",
        label: { ru: "Тип мусора", kk: "Қоқыс түрі" },
        type: "enum",
        required: true,
        options: [
          { value: "concrete", label: { ru: "Бетон", kk: "Бетон" } },
          { value: "brick", label: { ru: "Кирпич", kk: "Кірпіш" } },
          { value: "mixed", label: { ru: "Смешанный", kk: "Аралас" } },
          { value: "other", label: { ru: "Другое", kk: "Басқа" } },
        ],
        question: { ru: "Какой тип мусора нужно вывезти?", kk: "Қандай қоқыс шығару керек?" },
      },
      {
        // Текст, а не число в кубометрах.
        //
        // Заявка №100: человек написал «Два бака с мусором», а в заявку ушло
        // «объём — не знаю», потому что в число это не превращается. Тридцать
        // исполнителей получили заказ без главного параметра — по объёму они
        // и считают цену.
        //
        // В кубах мусор меряет тот, кто его возит. Заказчик меряет мешками,
        // баками и кузовами, и в таком виде исполнителю понятнее, чем «4 м³».
        key: "volumeM3",
        label: { ru: "Объём", kk: "Көлемі" },
        type: "text",
        required: false,
        allowUnknown: true,
        question: {
          ru: "Сколько примерно мусора? Можно на глаз — мешки, баки, кузов газели.",
          kk: "Қоқыс шамамен қанша? Шамалап айтыңыз — қаптар, бактар, газель шанағы.",
        },
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
        combineGroup: "when",
        label: { ru: "Дата", kk: "Күні" },
        type: "date",
        required: true,
        question: { ru: "На какую дату нужен вывоз?", kk: "Шығару қай күнге керек?" },
      },
      {
        key: "time",
        combineGroup: "when",
        label: { ru: "Время", kk: "Уақыт" },
        type: "time",
        required: true,
        question: { ru: "В какое время удобно?", kk: "Қай уақыт ыңғайлы?" },
      },
      {
        key: "address",
        label: { ru: "Адрес", kk: "Мекенжай" },
        type: "address",
        required: true,
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
        required: true,
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
        combineGroup: "when",
        label: { ru: "Дата", kk: "Күні" },
        type: "date",
        required: true,
        question: { ru: "На какую дату нужны грузчики?", kk: "Тиеушілер қай күнге керек?" },
      },
      {
        key: "time",
        combineGroup: "when",
        label: { ru: "Время", kk: "Уақыт" },
        type: "time",
        required: true,
        question: { ru: "К какому времени?", kk: "Қай уақытқа дейін?" },
      },
      {
        key: "address",
        label: { ru: "Адрес", kk: "Мекенжай" },
        type: "address",
        required: true,
        question: { ru: "Укажите адрес.", kk: "Мекенжайды көрсетіңіз." },
      },
    ],
  },
];
