/**
 * Прогресс регистрации переживает сброс сессии.
 *
 * Поставщик Жарбол, 28 августа: назвал имя, ответил на шесть вопросов о
 * категориях — и остался с пустым профилем. Всё собранное жило в состоянии
 * сессии, а её сбросило на последнем шаге. Владелец самосвала в Астане.
 *
 * Проверяем не «код вызывает сохранение», а результат: что лежит в профиле
 * после каждого ответа и что осталось, когда разговор оборвался.
 */
import { makeOnboarding } from "./lib/onboarding-harness.mjs";

const failures = [];
let checked = 0;
const check = (ok, what) => {
  checked++;
  if (!ok) failures.push(what);
};

const chatId = "77783030750@c.us";
const phone = "+77783030750";
const text = (t) => ({ text: t });
const button = (id) => ({ buttonReplyId: id, text: undefined });

// ── Новый исполнитель: путь Жарбола, оборванный на середине ────────────────
{
  const { service, db, sessions } = makeOnboarding();
  await service.start(chatId, phone, "ru");

  check(db.profile === null, "профиль создан до того, как человек назвался");

  await service.handleIncoming(chatId, phone, text("Жарбол"), "ru");
  check(db.profile?.companyName === "Жарбол", `имя не сохранено: ${db.profile?.companyName ?? "профиля нет"}`);
  check(db.profile?.confirmedAt == null, "регистрация не закончена, а согласие уже проставлено");

  // Отказ от автокрана, потом «моей нет в списке» и своя техника словами.
  await service.handleIncoming(chatId, phone, button("sup|cat|avtokran|false"), "ru");
  await service.handleIncoming(chatId, phone, button("sup|catnone"), "ru");
  await service.handleIncoming(chatId, phone, text("Самосвал 25 тонн"), "ru");

  check(
    db.categorySlugs.includes("samosval"),
    `самосвал не записан в профиль: [${db.categorySlugs.join(", ")}]`,
  );
  check(db.profile?.confirmedAt == null, "согласие проставлено посреди регистрации");

  // Разговор оборвался: сессия сброшена, как это и случилось у Жарбола.
  sessions.delete(chatId);
  check(
    db.profile?.companyName === "Жарбол" && db.categorySlugs.includes("samosval"),
    "после сброса сессии профиль опустел — то самое, что мы чиним",
  );

  // Возвращается и пишет «поставщик» заново: собранное подхватывается.
  //
  // Профиля может не быть вовсе — если прогресс не сохраняется, мы сюда
  // приходим с пустотой. Тогда проверка обязана сказать это словами, а не
  // упасть на обращении к null: непонятная поломка теста читается как
  // поломка теста, а не как найденная ошибка.
  const restarted = makeOnboarding({
    id: "supplier-1",
    companyName: db.profile?.companyName,
    confirmedAt: null,
    acceptsUrgent: true,
    categorySlugs: db.categorySlugs,
    cities: db.cities,
  });
  await restarted.service.start(chatId, phone, "ru");
  const greeting = restarted.sent[0]?.body ?? "";
  check(
    /Жарбол/.test(greeting),
    `при повторном заходе профиль не подхватился: «${greeting.slice(0, 60)}»`,
  );
}

// ── Существующий исполнитель: правку профиля прогресс не трогает ───────────
//
// Он зашёл менять категории и бросил на середине. Работающий профиль обязан
// остаться прежним — иначе починка одного случая ломает другой.
{
  const existing = {
    id: "supplier-9",
    companyName: "Азамат",
    confirmedAt: new Date("2026-08-01"),
    acceptsUrgent: true,
    categorySlugs: ["samosval", "gazelle"],
    cities: ["Астана"],
  };
  const { service, db } = makeOnboarding(existing);

  await service.start(chatId, phone, "ru");
  await service.handleIncoming(chatId, phone, text("Азамат"), "ru");
  await service.handleIncoming(chatId, phone, button("sup|cat|avtokran|false"), "ru");
  await service.handleIncoming(chatId, phone, button("sup|cat|gazelle|false"), "ru");

  check(
    db.categorySlugs.includes("samosval") && db.categorySlugs.includes("gazelle"),
    `правка на середине обеднила работающий профиль: [${db.categorySlugs.join(", ")}]`,
  );
  check(db.profile.confirmedAt != null, "у существующего исполнителя сбросилось согласие");
}

export default { name: "прогресс регистрации", checked, failures };
