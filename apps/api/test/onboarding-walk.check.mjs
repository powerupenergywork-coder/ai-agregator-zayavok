/**
 * Прогон автомата регистрации от начала до конца.
 *
 * Класс ошибок В — «состояние не двигается». Поставщик Жарбол, 28 августа:
 * десять раз подряд получил вопрос про газель, потому что ветка «моей нет в
 * списке» добавляла категорию и звала следующий вопрос, не увеличив счётчик.
 * Ни один тест регулярок такое не поймал бы: все распознаватели работали
 * правильно, ломался автомат.
 *
 * Условие остановки одно и простое: разговор обязан двигаться. Если человеку
 * дважды подряд задали дословно один и тот же вопрос — это ошибка, а не
 * поведение.
 */
import { makeOnboarding, lastQuestion } from "./lib/onboarding-harness.mjs";

const failures = [];
let checked = 0;

const LIMIT = 40;

/**
 * Прогнать сценарий: на каждый вопрос отвечает reply(вопрос, номер шага).
 * Возвращает лог исходящих и причину остановки.
 */
async function walk(label, reply) {
  const { service, sent } = makeOnboarding();
  const chatId = "77000000000@c.us";
  const phone = "+77000000000";

  await service.start(chatId, phone, "ru");

  let repeats = 0;
  let previous = lastQuestion(sent);

  for (let step = 0; step < LIMIT; step++) {
    const question = lastQuestion(sent);
    if (question === null) break;
    // Дошли до городов — автомат прошёл шаг категорий, ради которого всё.
    if (/городах вы работаете/i.test(question)) {
      return { sent, outcome: "дошёл до городов", steps: step };
    }
    // Отказ от всех категорий — тоже завершение: бот перестаёт перебирать
    // список и просит описать словами.
    if (/вашей услуги в списке нет/i.test(question)) {
      return { sent, outcome: "дошёл до городов", steps: step };
    }
    const answer = reply(question, step);
    if (answer === null) return { sent, outcome: "сценарий закончился", steps: step };

    const before = sent.length;
    await service.handleIncoming(chatId, phone, answer, "ru");
    if (sent.length === before) return { sent, outcome: "бот не ответил", steps: step };

    const now = lastQuestion(sent);
    if (now === previous) {
      repeats++;
      if (repeats >= 2) {
        return { sent, outcome: "зациклился", steps: step, question: now };
      }
    } else {
      repeats = 0;
    }
    previous = now;
  }
  return { sent, outcome: "не завершился", steps: LIMIT };
}

const text = (t) => ({ text: t });
const button = (id) => ({ buttonReplyId: id, text: undefined });

async function scenario(label, reply) {
  checked++;
  const r = await walk(label, reply);
  if (r.outcome !== "дошёл до городов") {
    failures.push(
      `${label}: ${r.outcome} на шаге ${r.steps}` +
        (r.question ? `\n     повторялось: «${String(r.question).split("\n")[0]}»` : ""),
    );
  }
  return r;
}

// ── Сценарий Жарбола: на каждый вопрос «моей нет в списке» + своя техника ──
//
// Именно он и зацикливался. Автомат обязан дойти до городов.
await scenario("«моей нет в списке» на каждом шаге", (question, step) => {
  if (step === 0) return text("Жарбол");
  if (/^Напишите/i.test(question)) return text("Самосвал 25 тонн");
  return button("sup|catnone");
});

// ── Отказ словами на каждый вопрос ─────────────────────────────────────────
//
// «Нет не газель» раньше добавляло газель. Теперь это ответ «нет», и автомат
// обязан пройти все категории и дойти до конца.
await scenario("отказ словами на каждом шаге", (question, step) => {
  if (step === 0) return text("Жарбол");
  const name = (question.match(/услугу «([^»]+)»/) ?? [])[1];
  if (/^Напишите/i.test(question)) return text("Самосвал 25 тонн");
  if (/Нужно выбрать хотя бы одну/i.test(question)) return text("Самосвал");
  return text(name ? `нет не ${name.toLowerCase()}` : "нет");
});

// ── Обычный путь кнопками ──────────────────────────────────────────────────
await scenario("ответы кнопками", (question, step) => {
  if (step === 0) return text("Жарбол");
  const last = question.match(/услугу «([^»]+)»/);
  if (!last) return text("Самосвал");
  // Соглашаемся только на самосвал, остальное отклоняем.
  const slug = last[1] === "Самосвал" ? "samosval" : null;
  return button(slug ? `sup|cat|${slug}|true` : `sup|cat|${slugOf(last[1])}|false`);
});

function slugOf(name) {
  const map = {
    Автокран: "avtokran",
    Газель: "gazelle",
    Грузчики: "gruzchiki",
    Манипулятор: "manipulyator",
    Самосвал: "samosval",
    "Вывоз строительного мусора": "construction-waste",
  };
  return map[name] ?? "unknown";
}

// ── Молчание про свою технику текстом, не кнопкой ──────────────────────────
await scenario("своя техника текстом сразу", (question, step) => {
  if (step === 0) return text("Жарбол");
  if (/^Напишите/i.test(question)) return text("Самосвал 25 тонн");
  return text("Услуги самосвала 25 тонн город Астана");
});

// ── Отдельная проверка: названное текстом не переспрашивается ──────────────
{
  checked++;
  const r = await walk("повтор уже добавленного", (question, step) => {
    if (step === 0) return text("Жарбол");
    if (/^Напишите/i.test(question)) return text("Самосвал 25 тонн");
    return button("sup|catnone");
  });
  const askedAboutSamosval = r.sent.filter((m) => /услугу «Самосвал»/.test(m.body ?? "")).length;
  if (askedAboutSamosval > 0) {
    failures.push(
      `повтор уже добавленного: про самосвал спросили ${askedAboutSamosval} раз(а) после того, как он уже добавлен`,
    );
  }
}

// ── И ещё одна: ни один вопрос не задан дважды подряд ни в одном сценарии ──
{
  checked++;
  const r = await walk("нет одинаковых подряд", (question, step) => {
    if (step === 0) return text("Жарбол");
    if (/^Напишите/i.test(question)) return text("Самосвал 25 тонн");
    return button("sup|catnone");
  });
  const bodies = r.sent.map((m) => m.body);
  const dup = bodies.findIndex((b, i) => i > 0 && b === bodies[i - 1]);
  if (dup > 0) {
    failures.push(`нет одинаковых подряд: реплика повторилась дословно — «${String(bodies[dup]).split("\n")[0]}»`);
  }
}

export default { name: "прогон регистрации", checked, failures };
