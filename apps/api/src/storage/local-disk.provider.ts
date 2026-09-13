import { Injectable } from "@nestjs/common";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { env } from "../config/env";
import { StorageProvider } from "./storage-provider.interface";

const UPLOADS_DIR = join(__dirname, "..", "..", "uploads");

@Injectable()
export class LocalDiskProvider implements StorageProvider {
  async upload(buffer: Buffer, filename: string, _mimeType: string): Promise<string> {
    await mkdir(UPLOADS_DIR, { recursive: true });
    // Имя файла приходит от клиента — из него берём только расширение, и то
    // санитизированное: одни буквы и цифры, обрезанные. Иначе хитрое имя
    // ("a...../../x") могло бы протащить слэши в ключ и увести writeFile за
    // пределы UPLOADS_DIR. Само имя в путь не идёт — файл всегда лежит под
    // случайным UUID.
    const rawExt = filename.includes(".") ? (filename.split(".").pop() ?? "") : "";
    const ext = (rawExt.match(/[a-z0-9]+/i)?.[0] ?? "bin").slice(0, 10).toLowerCase();
    const key = `${randomUUID()}.${ext}`;
    await writeFile(join(UPLOADS_DIR, key), buffer);
    return `${env.apiUrl}/uploads/${key}`;
  }
}
