import type { AttachmentKind } from "@zagros/domain";

export interface KernelConfig {
  defaultWorkspace: string;
  version: string;
  stdioMcpEnabled: boolean;
  masterKey?: string;
  publicBaseUrl?: string;
  skillsDir?: string;
  skillPublicKey?: string;
  rateLimitPerMinute?: number;
  maxConcurrentTasks?: number;
}

export interface RunnerSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onMessage(listener: (data: string) => void): void;
  onClose(listener: () => void): void;
}

export interface WsClientSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onMessage(listener: (data: string) => void): void;
  onClose(listener: () => void): void;
}

export interface HttpContext {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
  upload?: { name: string; mimeType?: string; data: Uint8Array };
  ip?: string;
}

export interface HttpReply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  raw?: boolean;
}

export type HttpHandler = (ctx: HttpContext) => Promise<HttpReply>;

export interface HttpRouteTable {
  get: Map<string, HttpHandler>;
  post: Map<string, HttpHandler>;
  put: Map<string, HttpHandler>;
  patch: Map<string, HttpHandler>;
  delete: Map<string, HttpHandler>;
}

const KIND_BY_MIME: Array<[RegExp, AttachmentKind]> = [
  [/^image\//, "image"],
  [/^video\//, "video"],
  [/^audio\//, "audio"],
  [/^text\//, "document"],
  [/^application\/pdf/, "document"],
  [/^application\/json/, "code"],
  [/^application\/x-(yaml|sh|bash|python)/, "code"],
  [/^application\/zip/, "file"],
  [/^application\/x-/, "file"],
];

export function detectKind(mimeType: string, name: string): AttachmentKind {
  for (const [pattern, kind] of KIND_BY_MIME) {
    if (pattern.test(mimeType)) return kind;
  }
  if (/\.(md|txt|log|yml|yaml|toml|ini|conf)$/i.test(name)) return "document";
  if (/\.(ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|sh|bash|json|sql|html|css)$/i.test(name)) return "code";
  if (/\.(png|jpe?g|gif|webp|heic|svg|bmp|ico)$/i.test(name)) return "image";
  if (/\.(mp4|mov|webm|mkv|avi)$/i.test(name)) return "video";
  if (/\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(name)) return "audio";
  if (/\.(zip|tar|gz|bz2|xz|7z|rar)$/i.test(name)) return "file";
  return "file";
}

export function jsonReply(status: number, body: unknown): HttpReply {
  return { status, body };
}

export function ok(body: unknown): HttpReply {
  return { status: 200, body };
}

export function created(body: unknown): HttpReply {
  return { status: 201, body };
}

export function badRequest(body: unknown = { error: "bad_request" }): HttpReply {
  return { status: 400, body };
}

export function unauthorized(body: unknown = { error: "unauthorized" }): HttpReply {
  return { status: 401, body };
}

export function forbidden(body: unknown = { error: "forbidden" }): HttpReply {
  return { status: 403, body };
}

export function notFound(body: unknown = { error: "not_found" }): HttpReply {
  return { status: 404, body };
}

export function conflict(body: unknown = { error: "conflict" }): HttpReply {
  return { status: 409, body };
}

export function unprocessable(body: unknown = { error: "unprocessable_entity" }): HttpReply {
  return { status: 422, body };
}

export function tooManyRequests(body: unknown = { error: "rate_limit_exceeded" }): HttpReply {
  return { status: 429, body };
}

export function serverError(body: unknown = { error: "internal_server_error" }): HttpReply {
  return { status: 500, body };
}

export function redirect(url: string): HttpReply {
  return { status: 302, body: "", headers: { location: url }, raw: true };
}

export function html(body: string): HttpReply {
  return { status: 200, body, headers: { "content-type": "text/html; charset=utf-8" }, raw: true };
}

