import type { ScheduledTaskWorkflow } from "./workflow.js";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  HUB: DurableObjectNamespace;
  WORKFLOW: Workflow<Parameters<ScheduledTaskWorkflow["run"]>[0]["payload"]>;
  ASSETS: Fetcher;
  VERSION: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  MAIN_URL?: string;
  ZAGROS_RUNNER_TOKEN?: string;
  ZAGROS_MASTER_KEY?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
  ZAGROS_SKILL_PUBLIC_KEY?: string;
}
