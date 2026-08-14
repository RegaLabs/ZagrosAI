import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  uploadsDir: string;
  workspacesDir: string;
  defaultWorkspace: string;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dataDir = resolve(env.ZAGROS_DATA ?? join(process.cwd(), "data"));
  const uploadsDir = join(dataDir, "uploads");
  const workspacesDir = join(dataDir, "workspaces");
  const defaultWorkspace = join(workspacesDir, "default");
  for (const dir of [dataDir, uploadsDir, workspacesDir, defaultWorkspace]) {
    mkdirSync(dir, { recursive: true });
  }
  return {
    host: env.ZAGROS_HOST ?? "127.0.0.1",
    port: Number(env.ZAGROS_PORT ?? 8787),
    dataDir,
    uploadsDir,
    workspacesDir,
    defaultWorkspace,
    logLevel: env.LOG_LEVEL ?? "info",
  };
}
