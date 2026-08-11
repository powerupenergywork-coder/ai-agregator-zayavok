/**
 * Иконки услуг.
 *
 * Нарисованы вручную, а не взяты картинками: фотографий техники у нас пока
 * нет, а чужие из интернета брать нельзя. Векторные иконки грузятся мгновенно,
 * не зависят от сети и одинаково выглядят на любом экране — для страницы, где
 * важна скорость первого показа с телефона, это дороже фотореализма.
 *
 * Когда появятся свои снимки техники (те же, что пойдут в рекламу), карточки
 * можно будет перевести на фото — разметка к этому готова.
 */
const ICONS: Record<string, React.ReactNode> = {
  // Манипулятор: борт со стрелой и крюком
  crane_truck: (
    <>
      <path d="M2 17h13v-5H8l-2 3H2z" />
      <path d="M8 12V7h3l7 4" />
      <path d="M18 11v4" />
      <circle cx="5.5" cy="18.5" r="1.5" />
      <circle cx="12.5" cy="18.5" r="1.5" />
    </>
  ),
  // Автокран: башня с тросом
  crane: (
    <>
      <path d="M3 20h9v-4H3z" />
      <path d="M7 16V4h12" />
      <path d="M19 4v6" />
      <path d="M7 7l6-3" />
      <circle cx="5.5" cy="20.5" r="1.5" />
      <circle cx="10" cy="20.5" r="1.5" />
    </>
  ),
  // Самосвал: кабина слева, кузов поднят передним краем — так, как он
  // выглядит при разгрузке. Ровный прямоугольный кузов читался бы как
  // обычный грузовик и не отличался бы от «Газели».
  dump_truck: (
    <>
      <path d="M2 15v-5h3.5L7 12.5V15" />
      <path d="M8.5 15V7.5L20 11.5V15" />
      <path d="M2 15h18" />
      <circle cx="5" cy="17.4" r="1.6" />
      <circle cx="16" cy="17.4" r="1.6" />
    </>
  ),
  // Газель: фургон
  van: (
    <>
      <path d="M2 16V8h11v8" />
      <path d="M13 11h4l3 3v2h-7z" />
      <circle cx="6" cy="17.5" r="1.5" />
      <circle cx="16" cy="17.5" r="1.5" />
    </>
  ),
  // Грузчики: двое несут коробку вместе. Одна фигура читалась бы как
  // «человек», а не как услуга: смысл именно в том, что приезжает бригада.
  loaders: (
    <>
      <circle cx="5" cy="5.5" r="1.8" />
      <circle cx="19" cy="5.5" r="1.8" />
      <path d="M5 7.5V19M19 7.5V19" />
      <path d="M5 11h3.5M19 11h-3.5" />
      <rect x="8.5" y="9" width="7" height="5.5" rx="0.8" />
    </>
  ),
  // Вывоз мусора: контейнер
  waste: (
    <>
      <path d="M4 8h16l-1.5 12h-13z" />
      <path d="M9 5h6v3H9z" />
      <path d="M10 12v5M14 12v5" />
    </>
  ),
};

export const SERVICE_ICON_KEYS = ["crane_truck", "crane", "dump_truck", "van", "loaders", "waste"] as const;

export function ServiceIcon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {ICONS[name] ?? ICONS.van}
    </svg>
  );
}
