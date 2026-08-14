import type { ObjectStore, StoredObject } from "@zagros/runtime";

export class R2ObjectStore implements ObjectStore {
  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, data: Uint8Array, options?: { contentType?: string }): Promise<void> {
    await this.bucket.put(key, data, { httpMetadata: { contentType: options?.contentType } });
  }

  async get(key: string): Promise<StoredObject | undefined> {
    const obj = await this.bucket.get(key);
    if (!obj) return undefined;
    return {
      data: new Uint8Array(await obj.arrayBuffer()),
      contentType: obj.httpMetadata?.contentType,
    };
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  publicUrl(key: string): string | undefined {
    return `/uploads/${encodeURIComponent(key)}`;
  }
}
