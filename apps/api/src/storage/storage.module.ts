import { Module } from "@nestjs/common";
import { env } from "../config/env";
import { STORAGE_PROVIDER } from "./storage-provider.interface";
import { LocalDiskProvider } from "./local-disk.provider";
import { S3Provider } from "./s3.provider";

@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      useClass: env.storageProvider === "s3" ? S3Provider : LocalDiskProvider,
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
