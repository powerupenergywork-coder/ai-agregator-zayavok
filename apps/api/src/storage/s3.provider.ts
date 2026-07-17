import { Injectable } from "@nestjs/common";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { env } from "../config/env";
import { StorageProvider } from "./storage-provider.interface";

/** Works against any S3-compatible endpoint, including the docker-compose MinIO. */
@Injectable()
export class S3Provider implements StorageProvider {
  private readonly client = new S3Client({
    endpoint: env.s3Endpoint,
    region: env.s3Region,
    forcePathStyle: env.s3ForcePathStyle,
    credentials: { accessKeyId: env.s3AccessKey, secretAccessKey: env.s3SecretKey },
  });

  async upload(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
    const ext = filename.includes(".") ? filename.split(".").pop() : "bin";
    const key = `${randomUUID()}.${ext}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: env.s3Bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
    return `${env.s3Endpoint}/${env.s3Bucket}/${key}`;
  }
}
