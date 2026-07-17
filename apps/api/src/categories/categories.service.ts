import { Injectable, NotFoundException } from "@nestjs/common";
import { CategoryField, CategoryTemplate } from "@ai-zayavki/shared";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllActive() {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
    return rows.map(toTemplate);
  }

  async findAllForAdmin() {
    const rows = await this.prisma.category.findMany({ orderBy: { name: "asc" } });
    return rows.map((r) => ({ ...toTemplate(r), id: r.id, isActive: r.isActive }));
  }

  async findBySlug(slug: string) {
    const row = await this.prisma.category.findUnique({ where: { slug } });
    if (!row) throw new NotFoundException("Категория не найдена");
    return toTemplate(row);
  }

  async findByIdOrThrow(id: string) {
    const row = await this.prisma.category.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Категория не найдена");
    return row;
  }

  /** Used by the AI module to build the classification prompt (name + examples per category). */
  async listForClassification() {
    const rows = await this.prisma.category.findMany({ where: { isActive: true } });
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      examples: r.examples as string[],
    }));
  }

  async create(template: Omit<CategoryTemplate, never>) {
    const row = await this.prisma.category.create({
      data: {
        slug: template.slug,
        name: template.name,
        icon: template.icon,
        examples: template.examples,
        fields: template.fields as any,
      },
    });
    return toTemplate(row);
  }

  async update(
    id: string,
    patch: Partial<Pick<CategoryTemplate, "name" | "icon" | "examples" | "fields">> & {
      isActive?: boolean;
    },
  ) {
    await this.findByIdOrThrow(id);
    const row = await this.prisma.category.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
        ...(patch.examples !== undefined ? { examples: patch.examples } : {}),
        ...(patch.fields !== undefined ? { fields: patch.fields as any } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      },
    });
    return toTemplate(row);
  }
}

function toTemplate(row: {
  slug: string;
  name: string;
  icon: string | null;
  examples: unknown;
  fields: unknown;
}): CategoryTemplate {
  return {
    slug: row.slug,
    name: row.name,
    icon: row.icon ?? undefined,
    examples: row.examples as string[],
    fields: row.fields as CategoryField[],
  };
}
