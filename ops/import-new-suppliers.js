/**
 * Загрузка собранных исполнителей — только новых.
 *
 *   node import-new-suppliers.js rows.json            # отчёт, ничего не пишет
 *   node import-new-suppliers.js rows.json --apply    # записать новых
 *
 * rows.json — вывод ops/suppliers-xlsx-to-json.py: { rows: [{ phone, city,
 * categorySlug, companyName? }] }. Запускается внутри контейнера api, где есть
 * Prisma и @ai-zayavki/shared.
 *
 * Почему не POST /admin/suppliers/import: для исполнителя, который уже есть в
 * базе, он ЗАМЕНЯЕТ категории и города на строки из файла. Человек, сам
 * зарегистрировавшийся в боте с пятью категориями, после импорта остался бы с
 * одной, найденной сотрудником на OLX, и молча перестал бы получать заявки.
 * Здесь существующие не трогаются — только перечисляются в отчёте.
 *
 * Сообщений скрипт не отправляет. Новые исполнители получают приглашение сами,
 * при первой подходящей заявке (confirmedAt = null → холодное приглашение).
 */
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const { resolveCityList } = require("@ai-zayavki/shared");

const [, , file, flag] = process.argv;
const APPLY = flag === "--apply";
const SOURCE = process.env.IMPORT_SOURCE || "xlsx";

// Та же нормализация, что в apps/api/src/common/phone.util.ts.
function normalizePhone(raw) {
  const digits = String(raw).replace(/[^\d]/g, "");
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) return `+7${digits.slice(1)}`;
  if (digits.length === 10) return `+7${digits}`;
  return `+${digits}`;
}
const isValidPhone = (p) => /^\+7\d{10}$/.test(p);

async function main() {
  const prisma = new PrismaClient();
  const { rows } = JSON.parse(fs.readFileSync(file, "utf8"));
  const categories = await prisma.category.findMany({ select: { id: true, slug: true } });
  const catId = new Map(categories.map((c) => [c.slug, c.id]));

  const merged = new Map();
  const rejected = [];
  rows.forEach((r, i) => {
    const phone = normalizePhone(r.phone ?? "");
    if (!isValidPhone(phone)) return rejected.push({ row: i + 1, phone: r.phone, reason: "номер не распознан" });
    if (!catId.has(r.categorySlug)) return rejected.push({ row: i + 1, phone, reason: `нет категории ${r.categorySlug}` });
    const { cities, unresolved } = resolveCityList(r.city ?? "");
    if (unresolved.length || !cities.length) return rejected.push({ row: i + 1, phone, reason: `город не распознан: ${r.city}` });
    let m = merged.get(phone);
    if (!m) merged.set(phone, (m = { phone, companyName: undefined, cities: new Set(), slugs: new Set() }));
    if (!m.companyName && r.companyName) m.companyName = String(r.companyName).trim();
    cities.forEach((c) => m.cities.add(c.name.ru));
    m.slugs.add(r.categorySlug);
  });

  const users = await prisma.user.findMany({
    where: { phone: { in: [...merged.keys()] } },
    select: {
      id: true, phone: true,
      supplierProfile: {
        select: {
          id: true, companyName: true, confirmedAt: true, isBlocked: true,
          categories: { select: { category: { select: { slug: true } } } },
          serviceAreas: { select: { city: true } },
        },
      },
    },
  });
  const byPhone = new Map(users.map((u) => [u.phone, u]));

  const toCreate = [];
  const existing = [];
  for (const m of merged.values()) {
    const u = byPhone.get(m.phone);
    if (u?.supplierProfile) {
      const p = u.supplierProfile;
      const haveSlugs = new Set(p.categories.map((c) => c.category.slug));
      const haveCities = new Set(p.serviceAreas.map((a) => a.city));
      existing.push({
        phone: m.phone,
        name: p.companyName || m.companyName || "",
        confirmed: !!p.confirmedAt,
        blocked: p.isBlocked,
        newCategories: [...m.slugs].filter((s) => !haveSlugs.has(s)),
        newCities: [...m.cities].filter((c) => !haveCities.has(c)),
      });
    } else {
      toCreate.push({ ...m, userId: u?.id ?? null });
    }
  }

  const byCategory = {};
  toCreate.forEach((m) => m.slugs.forEach((s) => (byCategory[s] = (byCategory[s] ?? 0) + 1)));
  const byCity = {};
  toCreate.forEach((m) => m.cities.forEach((c) => (byCity[c] = (byCity[c] ?? 0) + 1)));

  const report = {
    mode: APPLY ? "ЗАПИСЬ" : "ПРОВЕРКА (ничего не записано)",
    rowsIn: rows.length,
    uniquePhones: merged.size,
    rejected,
    willCreate: toCreate.length,
    existingNotTouched: existing.length,
    existingWithSomethingNew: existing.filter((e) => e.newCategories.length || e.newCities.length),
    existingUsersWithoutSupplierProfile: toCreate.filter((m) => m.userId).length,
    newByCategory: byCategory,
    newByCity: byCity,
  };

  if (APPLY) {
    let created = 0;
    for (const m of toCreate) {
      await prisma.$transaction(async (tx) => {
        // Та же логика, что upsertSupplier: WHATSAPP для новых, существующему
        // пользователю (например, бывшему заказчику) канал не меняем.
        const user = await tx.user.upsert({
          where: { phone: m.phone },
          create: { phone: m.phone, preferredChannel: "WHATSAPP" },
          update: {},
        });
        const profile = await tx.supplierProfile.create({
          data: { userId: user.id, companyName: m.companyName },
        });
        await tx.supplierCategory.createMany({
          data: [...m.slugs].map((s) => ({ supplierId: profile.id, categoryId: catId.get(s) })),
          skipDuplicates: true,
        });
        await tx.serviceArea.createMany({
          data: [...m.cities].map((city) => ({ supplierId: profile.id, city })),
        });
        await tx.auditLog.create({
          data: {
            actorType: "operator",
            action: "import_supplier",
            targetType: "SupplierProfile",
            targetId: profile.id,
            metadata: { source: SOURCE, categories: [...m.slugs], cities: [...m.cities] },
          },
        });
      });
      created++;
    }
    report.created = created;
  }

  console.log(JSON.stringify(report, null, 1));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
