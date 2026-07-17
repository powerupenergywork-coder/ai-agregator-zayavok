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
    const ext = filename.includes(".") ? filename.split(".").pop() : "bin";
    const key = `${randomUUID()}.${ext}`;
    await writeFile(join(UPLOADS_DIR, key), buffer);
    return `${env.apiUrl}/uploads/${key}`;
  }
}
