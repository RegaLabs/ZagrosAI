import { z } from "zod";

export const idSchema = z.string().min(1).max(100);
export type Id = z.infer<typeof idSchema>;

export const timestampSchema = z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
  message: "must be an ISO timestamp",
});
export type Timestamp = z.infer<typeof timestampSchema>;

export function now(): Timestamp {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  const p = prefix ? `${prefix}_` : "";
  return `${p}${crypto.randomUUID().replace(/-/g, "")}`;
}

