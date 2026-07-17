import { config as loadDotenv } from "dotenv";
import { join } from "path";

// Load the monorepo-root .env before anything else touches config/env.ts —
// npm workspaces run this script with cwd=apps/api, so dotenv's default
// "look in cwd" wouldn't find the root .env otherwise.
loadDotenv({ path: join(__dirname, "../../../.env") });

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: process.env.WEB_URL || "http://localhost:3000", credentials: true });
  // Serves photos uploaded via STORAGE_PROVIDER=local (see storage/local-disk.provider.ts).
  app.useStaticAssets(join(__dirname, "..", "uploads"), { prefix: "/uploads" });
  const port = process.env.API_PORT || 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://localhost:${port}`);
}

bootstrap();
