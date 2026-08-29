/**
 * Стенд для прогона регистрации исполнителя.
 *
 * Настоящий сервис из dist, подменены только внешние зависимости: база,
 * отправка в WhatsApp, справочник категорий и классификатор. Так проверяется
 * сам автомат — переходы, счётчик шагов и запись прогресса, — а не то, как мы
 * себе его представляем.
 *
 * Классификатор намеренно молчит: он ходит в сеть, а поведение автомата не
 * должно от него зависеть. Всё, что нужно распознать, распознаётся по основе
 * слова — как и у большинства реальных ответов.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");
require("reflect-metadata");

const CATEGORIES = [
  { id: "c1", slug: "avtokran", name: { ru: "Автокран", kk: "Автокран" } },
  { id: "c2", slug: "gazelle", name: { ru: "Газель", kk: "Газель" } },
  { id: "c3", slug: "gruzchiki", name: { ru: "Грузчики", kk: "Тиеушілер" } },
  { id: "c4", slug: "manipulyator", name: { ru: "Манипулятор", kk: "Манипулятор" } },
  { id: "c5", slug: "samosval", name: { ru: "Самосвал", kk: "Самосвал" } },
  { id: "c6", slug: "construction-waste", name: { ru: "Вывоз строительного мусора", kk: "Құрылыс қоқысын шығару" } },
];

/**
 * @param existing профиль, который уже есть в базе — для проверки, что правку
 *                 существующего профиля прогресс НЕ трогает.
 */
export function makeOnboarding(existing = null) {
  const { WhatsAppOnboardingService } = require(path.join(dist, "whatsapp/whatsapp-onboarding.service.js"));

  /** Исходящие: по ним видно, зациклился автомат или идёт вперёд. */
  const sent = [];
  const sessions = new Map();

  /** Слепок базы: что реально записано в профиль на каждый момент. */
  const db = {
    profile: existing ? { ...existing } : null,
    categorySlugs: existing?.categorySlugs ? [...existing.categorySlugs] : [],
    cities: existing?.cities ? [...existing.cities] : [],
    writes: 0,
  };

  const prisma = {
    whatsAppSession: {
      findUnique: async ({ where }) => sessions.get(where.chatId) ?? null,
    },
    supplierProfile: {
      findFirst: async () =>
        db.profile
          ? {
              ...db.profile,
              categories: db.categorySlugs.map((slug) => ({ category: { slug } })),
              serviceAreas: db.cities.map((city) => ({ city })),
            }
          : null,
      findUnique: async () => db.profile,
      upsert: async ({ create, update }) => {
        db.writes++;
        db.profile = db.profile
          ? { ...db.profile, ...update }
          : { id: "supplier-1", confirmedAt: null, ...create };
        return db.profile;
      },
      create: async ({ data }) => {
        db.writes++;
        db.profile = { id: "supplier-1", confirmedAt: null, ...data };
        return db.profile;
      },
      update: async ({ data }) => {
        db.writes++;
        db.profile = { ...(db.profile ?? { id: "supplier-1" }), ...data };
        return db.profile;
      },
    },
    user: { upsert: async () => ({ id: "user-1" }) },
    category: {
      findMany: async ({ where } = {}) => {
        const slugs = where?.slug?.in;
        return slugs ? CATEGORIES.filter((c) => slugs.includes(c.slug)) : CATEGORIES;
      },
      findUnique: async () => null,
    },
    supplierCategory: {
      deleteMany: async () => {
        db.categorySlugs = [];
        return {};
      },
      createMany: async ({ data }) => {
        db.categorySlugs = data.map((r) => CATEGORIES.find((c) => c.id === r.categoryId)?.slug).filter(Boolean);
        return {};
      },
      create: async () => ({}),
    },
    serviceArea: {
      deleteMany: async () => {
        db.cities = [];
        return {};
      },
      createMany: async ({ data }) => {
        db.cities = data.map((r) => r.city);
        return {};
      },
      create: async () => ({}),
    },
  };

  const categories = {
    findAllActive: async () => CATEGORIES,
    listForClassification: async () => CATEGORIES.map((c) => ({ slug: c.slug, name: c.name.ru, examples: [] })),
  };

  const sessionService = {
    setFlow: async (chatId, flow, stateData) => {
      sessions.set(chatId, { chatId, flow, stateData });
    },
    resetToOrderFlow: async (chatId) => {
      sessions.delete(chatId);
    },
  };

  const whatsapp = {
    sendText: async (phone, body) => {
      sent.push({ kind: "text", body });
    },
    sendButtons: async (phone, body, buttons) => {
      sent.push({ kind: "buttons", body, buttons });
    },
  };

  const service = new WhatsAppOnboardingService(
    prisma,
    categories,
    { log: async () => {} },
    sessionService,
    whatsapp,
    { markConverted: async () => {} },
    { classify: async () => null },
  );

  return { service, sent, sessions, db, CATEGORIES };
}

/** Последняя заданная человеку реплика — по ней сравниваем повторы. */
export function lastQuestion(sent) {
  return sent.length ? sent[sent.length - 1].body : null;
}
