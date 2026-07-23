import { Injectable, NotFoundException } from "@nestjs/common";
import { CategoryField, CategoryTemplate, LocalizedText } from "@ai-zayavki/shared";
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

  /** Admin panel is Russian-only by design — resolves the bilingual
   * name/examples down to plain .ru strings instead of the {ru,kk} objects
   * toTemplate() returns for the client/WhatsApp-facing endpoints, which the
   * admin UI (a plain string-rendering table) can't handle directly. */
  async findAllForAdmin() {
    const rows = await this.prisma.category.findMany({ orderBy: { name: "asc" } });
    return rows.map((r) => {
      const template = toTemplate(r);
      return {
        id: r.id,
        slug: template.slug,
        name: template.name.ru,
        icon: template.icon,
        examples: template.examples.map((e) => e.ru),
        fields: template.fields,
        isActive: r.isActive,
      };
    });
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

  /** Used by the AI module to build the classification prompt (name + examples per category) —
   * prompts stay Russian-only regardless of the client's language, see ai/*-ai.provider.ts. */
  async listForClassification() {
    const rows = await this.prisma.category.findMany({ where: { isActive: true } });
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: (r.name as unknown as LocalizedText).ru,
      examples: (r.examples as unknown as LocalizedText[]).map((e) => e.ru),
    }));
  }

  async create(template: Omit<CategoryTemplate, never>) {
    const row = await this.prisma.category.create({
      data: {
        slug: template.slug,
        name: template.name as any,
        icon: template.icon,
        examples: template.examples as any,
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
        ...(patch.name !== undefined ? { name: patch.name as any } : {}),
        ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
        ...(patch.examples !== undefined ? { examples: patch.examples as any } : {}),
        ...(patch.fields !== undefined ? { fields: patch.fields as any } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      },
    });
    return toTemplate(row);
  }
}

function toTemplate(row: {
  slug: string;
  name: unknown;
  icon: string | null;
  examples: unknown;
  fields: unknown;
}): CategoryTemplate {
  return {
    slug: row.slug,
    name: row.name as LocalizedText,
    icon: row.icon ?? undefined,
    examples: row.examples as LocalizedText[],
    fields: row.fields as CategoryField[],
  };
}
