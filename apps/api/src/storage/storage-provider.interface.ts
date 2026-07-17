export interface StorageProvider {
  /** Stores the buffer and returns a publicly reachable URL. */
  upload(buffer: Buffer, filename: string, mimeType: string): Promise<string>;
}

export const STORAGE_PROVIDER = Symbol("STORAGE_PROVIDER");
