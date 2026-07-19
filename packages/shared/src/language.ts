export type Language = "ru" | "kk";

// Kazakh-only Cyrillic letters (absent from Russian) — presence of any one is
// a reliable, cheap signal the text is Kazakh, no ML/AI call needed. Used to
// auto-detect which language to reply in, both in the WhatsApp bot and on the
// web app's free-text order description.
const KAZAKH_ONLY_LETTERS = /[әғқңөұүһіӘҒҚҢӨҰҮҺІ]/;

/** Returns null when the text is too short/ambiguous to tell — callers should
 * fall back to the stored preference (or "ru" if there isn't one yet). */
export function detectLanguage(text: string): Language | null {
  if (!text || text.trim().length < 2) return null;
  return KAZAKH_ONLY_LETTERS.test(text) ? "kk" : null;
}
