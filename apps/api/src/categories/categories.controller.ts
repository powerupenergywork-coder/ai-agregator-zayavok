import { Controller, Get, Param } from "@nestjs/common";
import { CategoriesService } from "./categories.service";

@Controller("categories")
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  findAll() {
    return this.categories.findAllActive();
  }

  @Get(":slug")
  findOne(@Param("slug") slug: string) {
    return this.categories.findBySlug(slug);
  }
}
