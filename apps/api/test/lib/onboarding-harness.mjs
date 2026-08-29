/**
 * Стенд для прогона регистрации исполнителя.
 *
 * Настоящий сервис из dist, подменены только внешние зависимости: база,
 * отправка в WhatsApp, справочник категорий и классификатор. Так проверяется
 * сам автомат — переходы и счётчик шагов, — а не то, как мы себе его
 * представляем.
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
  { slug: "avtokran", name: { ru: "Автокран", kk: "Автокран" } },
  { slug: "gazelle", name: { ru: "Газель", kk: "Газель" } },
  { slug: "gruzchiki", name: { ru: "Грузчики", kk: "Тиеушілер" } },
  { slug: "manipulyator", name: { ru: "Манипулятор", kk: "Манипулятор" } },
  { slug: "samosval", name: { ru: "Самосвал", kk: "Самосвал" } },
  { slug: "construction-waste", name: { ru: "Вывоз строительного мусора", kk: "Құрылыс қоқысын шығару" } },
];

export function makeOnboarding() {
  const { WhatsAppOnboardingService } = require(path.join(dist, "whatsapp/whatsapp-onboarding.service.js"));

  /** Исходящие: по ним и видно, зациклился автомат или идёт вперёд. */
  const sent = [];
  const sessions = new Map();

  const prisma = {
    whatsAppSession: {
      findUnique: async ({ where }) => sessions.get(where.chatId) ?? null,
    },
    supplierProfile: {
      findFirst: async () => null,
      upsert: async () => ({ id: "supplier-1" }),
      update: async () => ({}),
    },
    user: { upsert: async () => ({ id: "user-1" }) },
    category: { findMany: async () => CATEGORIES, findUnique: async () => null },
    supplierCategory: { deleteMany: async () => ({}), createMany: async () => ({}), create: async () => ({}) },
    serviceArea: { deleteMany: async () => ({}), createMany: async () => ({}), create: async () => ({}) },
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

  return { service, sent, sessions, CATEGORIES };
}

/** Последняя заданная человеку реплика — по ней сравниваем повторы. */
export function lastQuestion(sent) {
  return sent.length ? sent[sent.length - 1].body : null;
}
