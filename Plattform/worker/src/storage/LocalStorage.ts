import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ObjectStorage } from "./Storage.js";

export class LocalStorage implements ObjectStorage {
  constructor(
    private readonly rootDir: string,
    private readonly cdnBaseUrl = "https://cdn.example.com"
  ) {}

  async downloadToFile(storageKey: string, localPath: string): Promise<void> {
    await mkdir(dirname(localPath), { recursive: true });
    await copyFile(join(this.rootDir, storageKey), localPath);
  }

  async uploadFile(localPath: string, storageKey: string): Promise<void> {
    const destination = join(this.rootDir, storageKey);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(localPath, destination);
  }

  publicUrl(storageKey: string): string {
    return `${this.cdnBaseUrl.replace(/\/+$/, "")}/${storageKey.replace(/^\/+/, "")}`;
  }
}
