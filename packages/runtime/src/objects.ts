export interface StoredObject {
  data: Uint8Array;
  contentType?: string;
}

export interface ObjectStore {
  put(key: string, data: Uint8Array, options?: { contentType?: string }): Promise<void>;
  get(key: string): Promise<StoredObject | undefined>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string | undefined;
}
