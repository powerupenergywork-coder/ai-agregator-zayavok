/**
 * Прогон проверок разговора.
 *
 * Без фреймворка намеренно: в проекте его нет, а тащить jest ради двух
 * десятков сравнений строк — лишняя зависимость и лишние секунды на каждой
 * сборке. Каждый файл *.check.mjs экспортирует по умолчанию
 * { name, checked, failures } и сам решает, что и как проверяет.
 *
 * Запуск: npm run test -w apps/api (после сборки — проверки читают dist).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const files = fs
  .readdirSync(here)
  .filter((f) => f.endsWith(".check.mjs"))
  .sort();

let total = 0;
let failed = 0;

for (const file of files) {
  let report;
  try {
    report = (await import(pathToFileURL(path.join(here, file)).href)).default;
  } catch (err) {
    console.log(`✗ ${file}: ${err.message}`);
    failed++;
    continue;
  }
  total += report.checked;
  const bad = report.failures.length;
  failed += bad;
  console.log(`${bad === 0 ? "✓" : "✗"} ${report.name.padEnd(34)} проверок ${String(report.checked).padStart(3)}`);
  for (const f of report.failures) console.log(`    ${f}`);
}

console.log(`\nвсего проверок ${total}, ошибок ${failed}`);
process.exit(failed === 0 ? 0 : 1);
