/**
 * Legal identity of the operator, in one place because it has to match the
 * registration documents character for character wherever it appears — the
 * site footer, the privacy policy, and Meta's business verification all get
 * compared against the same certificate.
 */
export const COMPANY = {
  legalName: "ТОО «Power Solutions Company»",
  bin: "191240014214",
  address: "г. Астана, мкр. Жастар, пер. Жумабек Тәшенов, 10–81",
  phone: "+7 778 709 8251",
  phoneHref: "+77787098251",
  brand: "KerekTap",
  site: "kerektap.kz",
} as const;
