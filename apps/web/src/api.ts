import type {
  A2aAgentInfo,
  Agent,
  AgentPermissions,
  Approval,
  Artifact,
  AuditEvent,
  BrowserSession,
  ConnectorView,
  ConversationDetail,
  ConversationSummary,
  CreateMemoryInput,
  CreateRoutineInput,
  DepsScanResponse,
  ExecutorToolResponse,
  HealthInfo,
  McpServerStatus,
  MemoryKind,
  MemoryRecord,
  ModelConfig,
  OAuthProviderInfo,
  PatchMemoryInput,
  Routine,
  RoutineRun,
  SecurityStatus,
  SendMessageResponse,
  Settings,
  SkillDetail,
  SkillSummary,
  SkillTestResult,
  Task,
  ToolInfo,
  UploadResponse,
  Worker,
} from "./types.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function getJson<T>(path: string): Promise<T> {
  return request<T>("GET", path);
}

export function postJson<T>(path: string, body?: unknown): Promise<T> {
  return request<T>("POST", path, body);
}

export function putJson<T>(path: string, body?: unknown): Promise<T> {
  return request<T>("PUT", path, body);
}

export function del<T>(path: string): Promise<T> {
  return request<T>("DELETE", path);
}

export async function uploadFile(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/uploads", {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  return (await response.json()) as UploadResponse;
}

export const api = {
  health: () => getJson<HealthInfo>("/api/health"),
  securityStatus: () =>
    getJson<SecurityStatus>("/api/security/status"),
  depsScan: (dir?: string) =>
    postJson<DepsScanResponse>(
      "/api/security/deps-scan",
      dir !== undefined ? { dir } : undefined
    ),
  uploadFile: (file: File) => uploadFile(file),
  agents: () => getJson<Agent[]>("/api/agents"),
  createAgent: (body: {
    name: string;
    systemPrompt: string;
    model?: ModelConfig;
    permissions?: AgentPermissions;
    group?: string;
  }) => postJson<Agent>("/api/agents", body),
  updateAgent: (
    id: string,
    body: Partial<{
      name: string;
      systemPrompt: string;
      model: ModelConfig;
      permissions: AgentPermissions;
      group: string;
    }>
  ) => request<Agent>("PATCH", `/api/agents/${id}`, body),
  deleteAgent: (id: string) => del<{ ok: boolean }>(`/api/agents/${id}`),
  conversations: () => getJson<ConversationSummary[]>("/api/conversations"),
  createConversation: (body: { agentId: string; title?: string }) =>
    postJson<ConversationSummary>("/api/conversations", body),
  conversation: (id: string) =>
    getJson<ConversationDetail>(`/api/conversations/${id}`),
  deleteConversation: (id: string) =>
    del<{ ok: boolean }>(`/api/conversations/${id}`),
  sendMessage: (
    id: string,
    body: { content: string; attachments: { attachmentId: string }[] }
  ) => postJson<SendMessageResponse>(`/api/conversations/${id}/messages`, body),
  tasks: () => getJson<Task[]>("/api/tasks"),
  cancelTask: (id: string) => postJson<{ ok: boolean }>(`/api/tasks/${id}/cancel`),
  pauseTask: (id: string) => postJson<{ ok: boolean }>(`/api/tasks/${id}/pause`),
  resumeTask: (id: string) => postJson<{ ok: boolean }>(`/api/tasks/${id}/resume`),
  browserSessions: () =>
    getJson<{ sessions: BrowserSession[] }>("/api/browser/sessions"),
  browserScreenshot: (sessionId: string) =>
    postJson<{
      imageBase64: string;
      width: number;
      height: number;
      contentType: string;
    }>("/api/browser/screenshot", { sessionId }),
  executorTool: (toolId: string, args: Record<string, unknown>) =>
    postJson<ExecutorToolResponse>("/api/executor/tool", { toolId, args }),
  workers: () => getJson<Worker[]>("/api/workers"),
  tools: () => getJson<ToolInfo[]>("/api/tools"),
  settings: () => getJson<Settings>("/api/settings"),
  updateSettings: (body: {
    defaultModel?: ModelConfig;
    mcpServers?: unknown[];
  }) => putJson<Settings>("/api/settings", body),
  audit: (limit = 50) => getJson<AuditEvent[]>(`/api/audit?limit=${limit}`),
  approvals: () => getJson<Approval[]>("/api/approvals"),
  connectors: () => getJson<ConnectorView[]>("/api/connectors"),
  oauthProviders: () =>
    getJson<{ providers: OAuthProviderInfo[]; enabled: boolean }>(
      "/api/oauth/providers"
    ),
  mcpServers: () => getJson<{ servers: McpServerStatus[] }>("/api/mcp/servers"),
  memories: (params: { kind?: MemoryKind; q?: string }) => {
    const query = new URLSearchParams();
    if (params.kind) query.set("kind", params.kind);
    if (params.q) query.set("q", params.q);
    const qs = query.toString();
    return getJson<MemoryRecord[]>(qs ? `/api/memories?${qs}` : "/api/memories");
  },
  createMemory: (body: CreateMemoryInput) =>
    postJson<MemoryRecord>("/api/memories", body),
  patchMemory: (id: string, body: PatchMemoryInput) =>
    request<MemoryRecord>("PATCH", `/api/memories/${id}`, body),
  deleteMemory: (id: string) => del<{ ok: boolean }>(`/api/memories/${id}`),
  skills: () =>
    getJson<{ skills: SkillSummary[]; supported: boolean }>("/api/skills"),
  skillDetail: (name: string) =>
    getJson<SkillDetail>(`/api/skills/${encodeURIComponent(name)}`),
  installSkill: (source: string) =>
    postJson<{ ok: boolean; skill: SkillSummary }>("/api/skills/install", {
      source,
    }),
  deleteSkill: (name: string) =>
    del<{ ok: boolean }>(`/api/skills/${encodeURIComponent(name)}`),
  testSkill: (name: string) =>
    postJson<{ ok: boolean; results: SkillTestResult[] }>(
      `/api/skills/${encodeURIComponent(name)}/test`
    ),
  routines: () => getJson<Routine[]>("/api/routines"),
  createRoutine: (body: CreateRoutineInput) =>
    postJson<Routine>("/api/routines", body),
  updateRoutine: (id: string, patch: Partial<CreateRoutineInput>) =>
    request<Routine>("PATCH", `/api/routines/${id}`, patch),
  deleteRoutine: (id: string) =>
    del<{ ok: boolean }>(`/api/routines/${id}`),
  runRoutine: (id: string) =>
    postJson<RoutineRun>(`/api/routines/${id}/run`),
  testRoutine: (id: string, payload?: unknown) =>
    postJson<RoutineRun>(
      `/api/routines/${id}/test`,
      payload !== undefined ? { payload } : undefined
    ),
  routineRuns: (id: string) =>
    getJson<RoutineRun[]>(`/api/routines/${id}/runs`),
  allRoutineRuns: () => getJson<RoutineRun[]>("/api/routines/runs"),
  a2aAgents: () => getJson<A2aAgentInfo[]>("/api/a2a/agents"),
  artifacts: () => getJson<Artifact[]>("/api/artifacts"),
  decideApproval: (id: string, decision: "approved" | "rejected") =>
    postJson<{ ok: boolean }>(`/api/approvals/${id}/decide`, { decision }),
  revokeConnector: (id: string) => del<{ ok: boolean }>(`/api/connectors/${id}`),
  exportData: () =>
    getJson<{ version: string; exportedAt: string; data: Record<string, unknown[]> }>("/api/export"),
  importData: (data: Record<string, unknown[]>) =>
    postJson<{ ok: boolean; imported: number }>("/api/import", { data }),
};
