export interface ObjectStorage {
  downloadToFile(storageKey: string, localPath: string): Promise<void>;
  uploadFile(localPath: string, storageKey: string, contentType: string): Promise<void>;
  publicUrl(storageKey: string): string;
}
