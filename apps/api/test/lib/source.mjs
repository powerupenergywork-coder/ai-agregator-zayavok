/**
 * Достаём распознаватели и порядок проверок из СОБРАННОГО кода.
 *
 * Почему из dist, а не из исходника: там нет типов, и это ровно тот файл,
 * который запускается на проде. Копировать регулярки в тест нельзя — копия
 * расходится с оригиналом молча, и тест начинает подтверждать сам себя.
 *
 * Почему не импортом: нужные объявления лежат на уровне модуля и наружу не
 * выставлены, а импорт модуля целиком потянул бы NestJS, Prisma и половину
 * приложения. Здесь нужен только текст объявлений.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dist",
);

export function readCompiled(relativePath) {
  const full = path.join(DIST, relativePath);
  if (!fs.existsSync(full)) {
    throw new Error(
      `Нет собранного файла ${relativePath}. Сначала «npm run build -w apps/api».`,
    );
  }
  return fs.readFileSync(full, "utf8");
}

/**
 * Текст одного объявления верхнего уровня.
 *
 * Идём от `const ИМЯ =` или `function ИМЯ(` до места, где скобки снова
 * сбалансированы: объявления бывают многострочными (PRICE_QUESTION_RE
 * собирается из массива), и обрезать по первой точке с запятой нельзя.
 */
export function extractDeclaration(src, name) {
  const patterns = [`const ${name} = `, `function ${name}(`];
  let start = -1;
  for (const p of patterns) {
    const i = src.indexOf(`\n${p}`);
    if (i !== -1) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) throw new Error(`Объявление ${name} не найдено в собранном коде`);

  let depth = 0;
  let inString = null;
  let inRegex = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    const prev = src[i - 1];
    if (inString) {
      if (ch === inString && prev !== "\\") inString = null;
      continue;
    }
    if (inRegex) {
      if (ch === "/" && prev !== "\\") inRegex = false;
      else if (ch === "\n") inRegex = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    // Начало регулярного литерала: перед ним стоит «=», «(» или «|».
    if (ch === "/" && /[=(|,\s]/.test(prev ?? "") && src[i + 1] !== "/" && src[i + 1] !== "*") {
      inRegex = true;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (depth === 0 && (ch === ";" || (ch === "}" && src.startsWith(`\nfunction`, start - 1)))) {
      return src.slice(start, i + 1);
    }
  }
  throw new Error(`Не удалось дочитать объявление ${name}`);
}

/**
 * Собрать перечисленные объявления в один объект.
 *
 * Порядок имён важен: зависимости идут первыми (isAcknowledgement опирается
 * на ACK_RE и ACK_WORDS).
 */
export function buildScope(src, names) {
  const body = names.map((n) => extractDeclaration(src, n)).join("\n");
  const returned = `{ ${names.join(", ")} }`;
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\nreturn ${returned};`)();
}

/** Кусок файла между двумя опорными строками — чтобы читать порядок проверок
 *  внутри одной ветки, а не по всему файлу. */
export function sliceRegion(src, from, to) {
  const a = src.indexOf(from);
  if (a === -1) throw new Error(`Начало участка не найдено: ${from}`);
  const b = src.indexOf(to, a);
  if (b === -1) throw new Error(`Конец участка не найден: ${to}`);
  return src.slice(a, b);
}

/**
 * Порядок, в котором проверки стоят в коде.
 *
 * Это и есть суть проверки: побеждает первое совпадение, поэтому порядок —
 * часть поведения, а не оформление. Читаем его из кода, а не переписываем в
 * тест руками: переписанный порядок разошёлся бы с настоящим при первой же
 * правке, и тест продолжил бы говорить «всё хорошо».
 */
export function extractGuardOrder(region, knownGuards) {
  const found = [];
  // Любое употребление имени, кроме собственного объявления: распознаватель
  // вызывается то как `.test()`, то как аргумент `.match()`, то как обычная
  // функция. Ловить надо все три — иначе порядок прочитается неполным, а
  // неполный порядок хуже отсутствующего: он выглядит проверенным.
  const re = /(const\s+)?\b([A-Za-z][A-Za-z0-9_]{2,})\b/g;
  let m;
  while ((m = re.exec(region))) {
    if (m[1]) continue;
    const name = m[2];
    if (knownGuards.includes(name) && !found.includes(name)) found.push(name);
  }
  return found;
}
