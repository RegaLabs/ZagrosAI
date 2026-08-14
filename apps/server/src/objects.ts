import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { ObjectStore, StoredObject } from "@zagros/runtime";

export class FsObjectStore implements ObjectStore {
  constructor(private readonly rootDir: string) {}

  private resolve(key: string): string {
    if (!key || typeof key !== "string" || key.trim() === "" || key.includes("\0")) {
      throw new Error(`Invalid object key: key must be a non-empty string without null bytes`);
    }
    const normalized = key.replace(/\\/g, "/");
    const segments = normalized.split("/").filter(Boolean);
    if (segments.length === 0 || segments.some((s) => s === ".." || s === ".")) {
      throw new Error(`Invalid object key path (path traversal detected): ${key}`);
    }
    const rootResolved = resolve(this.rootDir);
    const sanitizedKey = normalized.replace(/^\/+/, "");
    const targetResolved = resolve(rootResolved, sanitizedKey);
    if (targetResolved === rootResolved || !targetResolved.startsWith(rootResolved + sep)) {
      throw new Error(`Invalid object key path: ${key}`);
    }
    return targetResolved;
  }

  async put(key: string, data: Uint8Array, options?: { contentType?: string }): Promise<void> {
    const target = this.resolve(key);
    await mkdir(dirname(target), { recursive: true });
    void options;
    await writeFile(target, data);
  }

  async get(key: string): Promise<StoredObject | undefined> {
    try {
      const buffer = await readFile(this.resolve(key));
      return { data: buffer, contentType: "application/octet-stream" };
    } catch {
      return undefined;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch {
      // best effort
    }
  }

  publicUrl(key: string): string {
    if (!key || typeof key !== "string") return "/uploads/";
    const sanitized = key.replace(/^\/+/, "").replace(/\\/g, "/");
    const encodedSegments = sanitized.split("/").filter(Boolean).map(encodeURIComponent);
    return `/uploads/${encodedSegments.join("/")}`;
  }
}
