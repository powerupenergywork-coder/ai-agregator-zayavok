// Canonical city dictionary.
//
// Dispatch matches a supplier's service area against the order's city, and
// that comparison used to be a plain string equality against whatever each
// side happened to type. In production that silently killed orders: the only
// dump-truck supplier had typed "Астана Алмата" into one field, so an order
// in "Астана" matched nobody and died with no explanation to anyone.
//
// So both sides now get resolved to an entry here before being stored, and
// unresolved input is bounced back to the user instead of being accepted and
// quietly failing later. Canonical form stored in the DB is `name.ru`, which
// keeps admin screens and digests readable without a data migration of the
// column type.

import { Language } from "./language";
import { LocalizedText } from "./category";

export interface CityEntry {
  slug: string;
  name: LocalizedText;
  /** Other spellings people actually use: old names, the other language's
   * name, common misspellings. Compared after normalizeCityInput(). */
  aliases: string[];
  /** Slugs this city's suppliers are assumed to also serve — satellites
   * within normal driving distance. Someone based in Астана takes jobs in
   * Косшы without thinking twice, and refusing to match that is just lost
   * business. Deliberately one-directional: a supplier in the satellite is
   * not assumed to cover the metro area. */
  nearby?: string[];
}

export const CITIES: CityEntry[] = [
  { slug: "astana", name: { ru: "Астана", kk: "Астана" }, aliases: ["нур-султан", "нурсултан", "нур султан", "целиноград", "акмола", "astana", "nur-sultan"], nearby: ["kosshy"] },
  { slug: "almaty", name: { ru: "Алматы", kk: "Алматы" }, aliases: ["алмата", "алма-ата", "алма ата", "almaty", "алматы қаласы"], nearby: ["talgar", "kaskelen"] },
  { slug: "shymkent", name: { ru: "Шымкент", kk: "Шымкент" }, aliases: ["чимкент", "shymkent"] },
  { slug: "karaganda", name: { ru: "Караганда", kk: "Қарағанды" }, aliases: ["карағанды", "қарағанды", "karaganda"], nearby: ["temirtau"] },
  { slug: "aktobe", name: { ru: "Актобе", kk: "Ақтөбе" }, aliases: ["актюбинск", "ақтөбе", "aktobe"] },
  { slug: "taraz", name: { ru: "Тараз", kk: "Тараз" }, aliases: ["джамбул", "жамбыл", "taraz"] },
  { slug: "pavlodar", name: { ru: "Павлодар", kk: "Павлодар" }, aliases: ["pavlodar"] },
  { slug: "oskemen", name: { ru: "Усть-Каменогорск", kk: "Өскемен" }, aliases: ["оскемен", "өскемен", "усть каменогорск", "устькаменогорск", "ust-kamenogorsk"] },
  { slug: "semey", name: { ru: "Семей", kk: "Семей" }, aliases: ["семипалатинск", "semey"] },
  { slug: "atyrau", name: { ru: "Атырау", kk: "Атырау" }, aliases: ["гурьев", "atyrau"] },
  { slug: "kostanay", name: { ru: "Костанай", kk: "Қостанай" }, aliases: ["кустанай", "қостанай", "kostanay"], nearby: ["rudny"] },
  { slug: "kyzylorda", name: { ru: "Кызылорда", kk: "Қызылорда" }, aliases: ["кзыл-орда", "кызыл-орда", "қызылорда", "kyzylorda"] },
  { slug: "uralsk", name: { ru: "Уральск", kk: "Орал" }, aliases: ["орал", "uralsk"] },
  { slug: "petropavlovsk", name: { ru: "Петропавловск", kk: "Петропавл" }, aliases: ["петропавл", "petropavlovsk"] },
  { slug: "aktau", name: { ru: "Актау", kk: "Ақтау" }, aliases: ["шевченко", "ақтау", "aktau"] },
  { slug: "temirtau", name: { ru: "Темиртау", kk: "Теміртау" }, aliases: ["теміртау", "temirtau"] },
  { slug: "turkestan", name: { ru: "Туркестан", kk: "Түркістан" }, aliases: ["түркістан", "turkestan"] },
  { slug: "kokshetau", name: { ru: "Кокшетау", kk: "Көкшетау" }, aliases: ["кокчетав", "көкшетау", "kokshetau"] },
  { slug: "taldykorgan", name: { ru: "Талдыкорган", kk: "Талдықорған" }, aliases: ["талдықорған", "taldykorgan"] },
  { slug: "ekibastuz", name: { ru: "Экибастуз", kk: "Екібастұз" }, aliases: ["екібастұз", "ekibastuz"] },
  { slug: "rudny", name: { ru: "Рудный", kk: "Рудный" }, aliases: ["rudny"] },
  { slug: "zhezkazgan", name: { ru: "Жезказган", kk: "Жезқазған" }, aliases: ["жезқазған", "zhezkazgan"] },
  { slug: "balkhash", name: { ru: "Балхаш", kk: "Балқаш" }, aliases: ["балқаш", "balkhash"] },
  { slug: "zhanaozen", name: { ru: "Жанаозен", kk: "Жаңаөзен" }, aliases: ["жаңаөзен", "zhanaozen"] },
  { slug: "kentau", name: { ru: "Кентау", kk: "Кентау" }, aliases: ["kentau"] },
  { slug: "kosshy", name: { ru: "Косшы", kk: "Қосшы" }, aliases: ["қосшы", "коши", "kosshy"] },
  { slug: "talgar", name: { ru: "Талгар", kk: "Талғар" }, aliases: ["талғар", "talgar"] },
  { slug: "kaskelen", name: { ru: "Каскелен", kk: "Қаскелең" }, aliases: ["қаскелең", "kaskelen"] },
];

/** Strips the noise people add around a city name so the same place typed
 * five different ways compares equal: case, "г."/"город" prefixes, ё/е,
 * punctuation, doubled spaces. */
export function normalizeCityInput(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\bг\s*\.\s*/g, "")
    .replace(/\b(город|қала|қаласы)\b/g, "")
    .replace(/[.,;!?"'()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** How much misspelling to forgive. Short names get one edit, longer ones
 * two — enough for "Алмата"/"Кустанай", tight enough that distinct cities
 * (Актау vs Актобе, distance 2 over 6 chars) never collapse into each other. */
function tolerance(len: number): number {
  if (len <= 4) return 0;
  if (len <= 7) return 1;
  return 2;
}

/** Resolves one city name. Exact match on any spelling first, then a
 * near-miss pass. Returns null when nothing is close enough — callers are
 * expected to ask the user rather than guess. */
export function resolveCity(raw: string): CityEntry | null {
  const q = normalizeCityInput(raw);
  if (!q) return null;

  for (const c of CITIES) {
    const forms = [c.name.ru, c.name.kk, ...c.aliases].map(normalizeCityInput);
    if (forms.includes(q)) return c;
  }

  let best: { city: CityEntry; dist: number } | null = null;
  for (const c of CITIES) {
    const forms = [c.name.ru, c.name.kk, ...c.aliases].map(normalizeCityInput);
    for (const f of forms) {
      const d = levenshtein(q, f);
      if (d <= tolerance(Math.max(q.length, f.length)) && (!best || d < best.dist)) {
        best = { city: c, dist: d };
      }
    }
  }
  return best?.city ?? null;
}

export interface CityListResolution {
  cities: CityEntry[];
  /** Fragments we could not place. Present them back to the user — never
   * store them, or they become another order that matches nobody. */
  unresolved: string[];
}

/** Resolves a user-typed list like "Астана, Алматы". Falls back to splitting
 * on whitespace for any fragment that doesn't resolve as a whole, which is
 * what rescues the real-world "Астана Алмата" — two cities, no comma. */
export function resolveCityList(raw: string): CityListResolution {
  const cities: CityEntry[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();

  const push = (c: CityEntry) => {
    if (seen.has(c.slug)) return;
    seen.add(c.slug);
    cities.push(c);
  };

  for (const chunk of raw.split(/[,;/\n]+/).map((s) => s.trim()).filter(Boolean)) {
    const direct = resolveCity(chunk);
    if (direct) {
      push(direct);
      continue;
    }
    // "Нур-Султан и Алмата" — drop the conjunctions before treating the
    // leftovers as separate city names.
    const words = chunk.split(/\s+/).filter((w) => w && !/^(и|және|плюс)$/i.test(w));
    const resolvedWords = words.map((w) => resolveCity(w));
    if (words.length > 1 && resolvedWords.every((r) => r !== null)) {
      resolvedWords.forEach((r) => push(r!));
      continue;
    }
    unresolved.push(chunk);
  }

  return { cities, unresolved };
}

/** Canonical names of every city whose suppliers should see an order placed
 * in `cityName` — the city itself plus anyone listing it as a satellite.
 * Feeds the `city IN (...)` filter in supplier matching. */
export function citiesServing(cityName: string): string[] {
  const target = resolveCity(cityName);
  if (!target) return [cityName];
  const names = [target.name.ru];
  for (const c of CITIES) {
    if (c.nearby?.includes(target.slug)) names.push(c.name.ru);
  }
  return names;
}

/** Short prompt listing where we actually operate, for the "didn't catch
 * that city" reply. Kept to the biggest ones — the full list is a wall of
 * text in a chat message. */
export function citySuggestions(lang: Language, limit = 6): string {
  return CITIES.slice(0, limit)
    .map((c) => c.name[lang])
    .join(", ");
}
