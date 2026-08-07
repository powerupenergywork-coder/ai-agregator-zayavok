import { KaspiResponse } from "./kaspi-biller.service";

/**
 * Ответ в XML. Протокол разрешает и XML, и JSON, но ведёт именно с XML, и
 * какой формат читает их парсер на самом деле, снаружи не видно — поэтому
 * умеем оба, а выбор оставлен настройке и самому запросу.
 *
 * Собираем строкой, а не библиотекой: структура — пять полей и плоский
 * список fields, зафиксированный протоколом. Зависимость ради этого была бы
 * дороже, чем сама задача.
 */
export function toKaspiXml(r: KaspiResponse): string {
  const lines = [`<?xml version="1.0" encoding="UTF-8"?>`, `<response>`];
  lines.push(`  <txn_id>${esc(r.txn_id)}</txn_id>`);
  // prv_txn, а не prv_txn_id: так это поле называется именно в XML-примере
  // протокола. В JSON оно называется иначе, и там отдаются оба имени.
  if (r.prv_txn) lines.push(`  <prv_txn>${esc(r.prv_txn)}</prv_txn>`);
  if (r.sum) lines.push(`  <sum>${esc(r.sum)}</sum>`);
  lines.push(`  <result>${r.result}</result>`);
  if (r.fields) {
    lines.push(`  <fields>`);
    Object.entries(r.fields).forEach(([key, f], i) => {
      // Имя тега протокол задаёт как field1, field2… — порядковым номером, а
      // не ключом объекта, поэтому нумеруем сами.
      lines.push(`    <field${i + 1} name="${esc(f["@name"])}">${esc(f["#text"])}</field${i + 1}>`);
    });
    lines.push(`  </fields>`);
  }
  lines.push(`  <comment>${esc(r.comment ?? "")}</comment>`);
  lines.push(`</response>`);
  return lines.join("\n");
}

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
