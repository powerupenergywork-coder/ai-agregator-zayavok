import { PrismaClient } from "@prisma/client";
import { CATEGORY_SEED_DATA } from "../src/categories/category-seed-data";
import { hashPassword } from "../src/admin/password.util";

const prisma = new PrismaClient();

async function main() {
  for (const template of CATEGORY_SEED_DATA) {
    await prisma.category.upsert({
      where: { slug: template.slug },
      create: {
        slug: template.slug,
        name: template.name,
        icon: template.icon,
        examples: template.examples,
        fields: template.fields as any,
      },
      update: {
        name: template.name,
        icon: template.icon,
        examples: template.examples,
        fields: template.fields as any,
      },
    });
  }
  console.log(`Seeded ${CATEGORY_SEED_DATA.length} categories`);

  // Overridable so production seeding doesn't ship the well-known dev
  // credentials — set ADMIN_SEED_EMAIL/ADMIN_SEED_PASSWORD in .env before
  // running the seed on a real server.
  const adminEmail = process.env.ADMIN_SEED_EMAIL || "admin@example.com";
  const adminPassword = process.env.ADMIN_SEED_PASSWORD || "admin12345";
  await prisma.adminUser.upsert({
    where: { email: adminEmail },
    create: { email: adminEmail, passwordHash: hashPassword(adminPassword), role: "ADMIN", name: "Admin" },
    update: {},
  });
  console.log(`Seeded admin user: ${adminEmail} / ${adminPassword}`);

  await prisma.dispatchSettings.upsert({
    where: { id: (await prisma.dispatchSettings.findFirst())?.id ?? "seed-default" },
    create: { id: "seed-default", waveSize: 15 },
    update: {},
  });

  // A couple of demo suppliers per category/city so the matching engine has
  // candidates to dispatch to during local smoke testing.
  const demoCity = "Астана";
  const manipulatorCategory = await prisma.category.findUnique({ where: { slug: "crane-truck" } });
  const gazelleCategory = await prisma.category.findUnique({ where: { slug: "gazelle" } });
  const autoCraneCategory = await prisma.category.findUnique({ where: { slug: "crane" } });

  const demoSuppliers = [
    { phone: "+77010000001", companyName: "ТОО Манипулятор24", categoryId: manipulatorCategory?.id },
    { phone: "+77010000002", companyName: "Быстрые грузоперевозки", categoryId: manipulatorCategory?.id },
    { phone: "+77010000003", companyName: "Газель-Сервис", categoryId: gazelleCategory?.id },
    { phone: "+77010000004", companyName: "Автокран-Сервис", categoryId: autoCraneCategory?.id },
  ];

  for (const s of demoSuppliers) {
    if (!s.categoryId) continue;
    const user = await prisma.user.upsert({ where: { phone: s.phone }, create: { phone: s.phone }, update: {} });
    const supplier = await prisma.supplierProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, companyName: s.companyName, rating: 4.5 },
      update: { companyName: s.companyName },
    });
    await prisma.supplierCategory.upsert({
      where: { supplierId_categoryId: { supplierId: supplier.id, categoryId: s.categoryId } },
      create: { supplierId: supplier.id, categoryId: s.categoryId },
      update: {},
    });
    const existingArea = await prisma.serviceArea.findFirst({ where: { supplierId: supplier.id, city: demoCity } });
    if (!existingArea) {
      await prisma.serviceArea.create({ data: { supplierId: supplier.id, city: demoCity } });
    }
  }
  console.log(`Seeded ${demoSuppliers.length} demo suppliers in ${demoCity}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
