import { create } from "zustand";
import { api, del, postJson } from "./api.js";
import { getLang } from "./i18n.js";
import type { Lang } from "./i18n.js";
import type {
  A2aAgentInfo,
  Agent,
  AgentPermissions,
  Approval,
  Artifact,
  BrowserSession,
  ConnectorView,
  ConversationSummary,
  CreateMemoryInput,
  CreateRoutineInput,
  DepsScanResponse,
  FilesEntry,
  McpServerConfig,
  McpServerStatus,
  MemoryRecord,
  Message,
  ModelConfig,
  OAuthProviderInfo,
  PatchMemoryInput,
  Routine,
  RoutineRun,
  SecurityStatus,
  ServerEvent,
  Settings,
  SkillSummary,
  SkillTestResult,
  StreamingBuffer,
  Task,
  TaskStatus,
  ToolInfo,
  UploadResponse,
  Worker,
} from "./types.js";
import { WebSocketClient } from "./ws.js";

let wsClient: WebSocketClient | null = null;
let reconnectDelay = 1000;
let reconnectTimerId: number | null = null;
let userClosed = false;
let screenshotTimer: number | null = null;

const LANG_STORAGE_KEY = "zagros-lang";

function initialLang(): Lang {
  try {
    if (typeof localStorage === "undefined") return getLang();
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    return stored === "en" || stored === "ku" ? stored : getLang();
  } catch {
    return getLang();
  }
}

function startScreenshotPolling() {
  if (screenshotTimer !== null) return;
  screenshotTimer = window.setInterval(() => {
    const state = useStore.getState();
    if (!state.screenshotPolling) {
      stopScreenshotPolling();
      return;
    }
    const sessionId = state.selectedBrowserSessionId ?? state.browserSessions[0]?.id;
    if (sessionId) void state.refreshScreenshot(sessionId).catch(() => {});
  }, 3000);
}

function stopScreenshotPolling() {
  if (screenshotTimer !== null) {
    window.clearInterval(screenshotTimer);
    screenshotTimer = null;
  }
}

function wsUrl(): string {
  const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
  if (envUrl) return envUrl;
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws`;
}

function upsertTask(tasks: Task[], task: Task): Task[] {
  const index = tasks.findIndex((t) => t.id === task.id);
  if (index === -1) return [task, ...tasks];
  const next = [...tasks];
  next[index] = task;
  return next;
}

function upsertWorker(workers: Worker[], worker: Worker): Worker[] {
  const index = workers.findIndex((w) => w.id === worker.id);
  if (index === -1) return [...workers, worker];
  const next = [...workers];
  next[index] = worker;
  return next;
}

function upsertConversation(
  conversations: ConversationSummary[],
  conversation: ConversationSummary
): ConversationSummary[] {
  if (conversations.some((c) => c.id === conversation.id)) return conversations;
  return [conversation, ...conversations];
}

export const LIVE_TASK_STATUSES: TaskStatus[] = [
  "queued",
  "running",
  "waiting_for_tool",
  "waiting_for_approval",
  "verifying",
];

export function newestLiveTask(tasks: Task[], conversationId: string): Task | null {
  const matches = tasks.filter((t) => t.conversationId === conversationId);
  if (matches.length === 0) return null;
  const newest = [...matches].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!newest) return null;
  return LIVE_TASK_STATUSES.includes(newest.status) ? newest : null;
}

export interface CreateAgentInput {
  name: string;
  systemPrompt: string;
  model: ModelConfig;
  permissions?: AgentPermissions;
  group?: string;
}

export type Tab =
  | "chats"
  | "agents"
  | "tasks"
  | "capabilities"
  | "routines"
  | "delegation"
  | "memory"
  | "skills"
  | "settings";

export type ActivityTab = "live" | "browser" | "terminal" | "files";

export type ApprovalDecision = "approved" | "rejected";

export interface MemoryFilter {
  kind: "all" | MemoryRecord["kind"];
  q: string;
}

export interface BrowserScreenshot {
  imageBase64: string;
  width: number;
  height: number;
  contentType: string;
  sessionId: string;
}

export interface FilesContent {
  path: string;
  content: string;
  encoding?: string;
}

interface StoreState {
  connected: boolean;
  lang: Lang;
  agents: Agent[];
  conversations: ConversationSummary[];
  tasks: Task[];
  workers: Worker[];
  settings: Settings | null;
  securityStatus: SecurityStatus | null;
  tools: ToolInfo[];
  approvals: Approval[];
  connectors: ConnectorView[];
  oauthProviders: OAuthProviderInfo[];
  oauthEnabled: boolean;
  mcpServers: McpServerStatus[];
  memories: MemoryRecord[];
  memoryFilter: MemoryFilter;
  skills: SkillSummary[];
  skillsSupported: boolean;
  routines: Routine[];
  routineRuns: RoutineRun[];
  a2aAgents: A2aAgentInfo[];
  artifacts: Artifact[];
  messagesByConversation: Record<string, Message[]>;
  streamingByConversation: Record<string, StreamingBuffer>;
  activeConversationId: string | null;
  activeTab: Tab;
  activityTab: ActivityTab;
  browserSessions: BrowserSession[];
  selectedBrowserSessionId: string | null;
  browserScreenshot: BrowserScreenshot | null;
  screenshotPolling: boolean;
  filesPath: string;
  filesEntries: FilesEntry[];
  filesContent: FilesContent | null;
  connectWs: () => void;
  setLang: (lang: Lang) => void;
  loadAll: () => Promise<void>;
  refreshAgents: () => Promise<void>;
  refreshConversations: () => Promise<void>;
  refreshTasks: () => Promise<void>;
  refreshWorkers: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  fetchSecurityStatus: () => Promise<void>;
  runDepsScan: (dir?: string) => Promise<DepsScanResponse>;
  refreshTools: () => Promise<void>;
  fetchApprovals: () => Promise<void>;
  decideApproval: (id: string, decision: ApprovalDecision) => Promise<void>;
  fetchConnectors: () => Promise<void>;
  revokeConnector: (id: string) => Promise<void>;
  fetchOauthProviders: () => Promise<void>;
  fetchMcpServers: () => Promise<void>;
  connectProvider: (providerId: string) => void;
  authorizeMcpServer: (serverId: string) => void;
  setActiveTab: (tab: Tab) => void;
  setActiveConversation: (id: string | null) => void;
  setActivityTab: (tab: ActivityTab) => void;
  pauseTask: (taskId: string) => Promise<void>;
  resumeTask: (taskId: string) => Promise<void>;
  refreshBrowserSessions: () => Promise<void>;
  refreshScreenshot: (sessionId: string) => Promise<void>;
  toggleScreenshotPolling: () => void;
  selectBrowserSession: (id: string) => void;
  listFiles: (path: string) => Promise<void>;
  readFile: (path: string) => Promise<void>;
  navigateActivity: (path: string) => Promise<void>;
  createAgent: (input: CreateAgentInput) => Promise<Agent>;
  updateAgent: (
    id: string,
    patch: Partial<{
      name: string;
      systemPrompt: string;
      model: ModelConfig;
      permissions: AgentPermissions;
      group: string;
    }>
  ) => Promise<Agent>;
  deleteAgent: (id: string) => Promise<void>;
  createConversation: (agentId: string) => Promise<ConversationSummary>;
  deleteConversation: (id: string) => Promise<void>;
  loadConversation: (id: string) => Promise<void>;
  sendMessage: (
    conversationId: string,
    content: string,
    attachments: { attachmentId: string }[]
  ) => Promise<void>;
  uploadFile: (file: File) => Promise<UploadResponse>;
  cancelTask: (taskId: string) => Promise<void>;
  updateSettings: (patch: {
    defaultModel?: ModelConfig;
    mcpServers?: McpServerConfig[];
  }) => Promise<void>;
  fetchMemories: () => Promise<void>;
  setMemoryFilter: (partial: Partial<MemoryFilter>) => void;
  addMemory: (body: CreateMemoryInput) => Promise<void>;
  editMemory: (id: string, patch: PatchMemoryInput) => Promise<void>;
  forgetMemory: (id: string) => Promise<void>;
  fetchSkills: () => Promise<void>;
  installSkill: (source: string) => Promise<void>;
  removeSkill: (name: string) => Promise<void>;
  runSkillTests: (name: string) => Promise<SkillTestResult[]>;
  fetchRoutines: () => Promise<void>;
  createRoutine: (body: CreateRoutineInput) => Promise<Routine>;
  updateRoutine: (
    id: string,
    patch: Partial<CreateRoutineInput>
  ) => Promise<Routine>;
  deleteRoutine: (id: string) => Promise<void>;
  runRoutine: (id: string) => Promise<void>;
  testRoutine: (id: string) => Promise<void>;
  fetchRoutineRuns: (routineId?: string) => Promise<void>;
  fetchA2aAgents: () => Promise<void>;
  fetchArtifacts: () => Promise<void>;
  exportData: () => Promise<{
    version: string;
    exportedAt: string;
    data: Record<string, unknown[]>;
  }>;
  importData: (data: Record<string, unknown[]>) => Promise<number>;
  handleWsEvent: (raw: unknown) => void;
}

export const useStore = create<StoreState>((set, get) => ({
  connected: false,
  lang: initialLang(),
  agents: [],
  conversations: [],
  tasks: [],
  workers: [],
  settings: null,
  securityStatus: null,
  tools: [],
  approvals: [],
  connectors: [],
  oauthProviders: [],
  oauthEnabled: false,
  mcpServers: [],
  memories: [],
  memoryFilter: { kind: "all", q: "" },
  skills: [],
  skillsSupported: false,
  routines: [],
  routineRuns: [],
  a2aAgents: [],
  artifacts: [],
  messagesByConversation: {},
  streamingByConversation: {},
  activeConversationId: null,
  activeTab: "chats",
  activityTab: "live",
  browserSessions: [],
  selectedBrowserSessionId: null,
  browserScreenshot: null,
  screenshotPolling: false,
  filesPath: ".",
  filesEntries: [],
  filesContent: null,

  connectWs() {
    if (reconnectTimerId !== null) {
      window.clearTimeout(reconnectTimerId);
      reconnectTimerId = null;
    }
    if (wsClient) return;
    userClosed = false;
    const client = new WebSocketClient(wsUrl());
    wsClient = client;
    client.onopen = () => {
      reconnectDelay = 1000;
      set({ connected: true });
    };
    client.onmessage = (data) => {
      get().handleWsEvent(data);
    };
    client.onclose = () => {
      set({ connected: false });
      wsClient = null;
      if (userClosed) return;
      reconnectTimerId = window.setTimeout(() => {
        reconnectTimerId = null;
        reconnectDelay = Math.min(reconnectDelay * 2, 15000);
        get().connectWs();
      }, reconnectDelay);
    };
    client.connect();
  },

  setLang(lang) {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(LANG_STORAGE_KEY, lang);
      }
    } catch {
      void 0;
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
    }
    set({ lang });
  },

  async loadAll() {
    const [agents, conversations, tasks, workers, settings, tools] = await Promise.all([
      api.agents(),
      api.conversations(),
      api.tasks(),
      api.workers(),
      api.settings(),
      api.tools(),
    ]);
    set({ agents, conversations, tasks, workers, settings, tools });
    void get().fetchApprovals();
    void get().fetchConnectors();
    void get().fetchOauthProviders();
    void get().fetchMcpServers();
  },

  async refreshAgents() {
    set({ agents: await api.agents() });
  },

  async refreshConversations() {
    set({ conversations: await api.conversations() });
  },

  async refreshTasks() {
    set({ tasks: await api.tasks() });
  },

  async refreshWorkers() {
    set({ workers: await api.workers() });
  },

  async refreshSettings() {
    set({ settings: await api.settings() });
  },

  async fetchSecurityStatus() {
    set({ securityStatus: await api.securityStatus() });
  },

  async runDepsScan(dir) {
    return api.depsScan(dir);
  },

  async refreshTools() {
    set({ tools: await api.tools() });
  },

  async fetchApprovals() {
    set({ approvals: await api.approvals() });
  },

  async decideApproval(id, decision) {
    set((state) => ({
      approvals: state.approvals.map((a) =>
        a.id === id ? { ...a, status: decision } : a
      ),
    }));
    await api.decideApproval(id, decision);
    await get().fetchApprovals();
  },

  async fetchConnectors() {
    set({ connectors: await api.connectors() });
  },

  async revokeConnector(id) {
    await api.revokeConnector(id);
    await get().fetchConnectors();
  },

  async fetchOauthProviders() {
    const result = await api.oauthProviders();
    set({ oauthProviders: result.providers, oauthEnabled: result.enabled });
  },

  async fetchMcpServers() {
    const result = await api.mcpServers();
    set({ mcpServers: result.servers });
  },

  connectProvider(providerId) {
    window.location.href = `/api/oauth/${providerId}/authorize`;
  },

  authorizeMcpServer(serverId) {
    window.location.href = `/api/mcp/servers/${serverId}/auth`;
  },

  setActiveTab(tab) {
    set({ activeTab: tab });
  },

  setActiveConversation(id) {
    set({ activeConversationId: id });
  },

  setActivityTab(tab) {
    set({ activityTab: tab });
    if (tab === "browser") void get().refreshBrowserSessions().catch(() => {});
  },

  async pauseTask(taskId) {
    await api.pauseTask(taskId);
    await get().refreshTasks();
  },

  async resumeTask(taskId) {
    await api.resumeTask(taskId);
    await get().refreshTasks();
  },

  async refreshBrowserSessions() {
    const { sessions } = await api.browserSessions();
    set((state) => ({
      browserSessions: sessions,
      selectedBrowserSessionId:
        state.selectedBrowserSessionId !== null &&
        sessions.some((s) => s.id === state.selectedBrowserSessionId)
          ? state.selectedBrowserSessionId
          : (sessions[0]?.id ?? null),
    }));
  },

  async refreshScreenshot(sessionId) {
    const shot = await api.browserScreenshot(sessionId);
    set({
      browserScreenshot: {
        imageBase64: shot.imageBase64,
        width: shot.width,
        height: shot.height,
        contentType: shot.contentType,
        sessionId,
      },
    });
  },

  toggleScreenshotPolling() {
    const { screenshotPolling } = get();
    if (screenshotPolling) {
      stopScreenshotPolling();
      set({ screenshotPolling: false });
      return;
    }
    set({ screenshotPolling: true });
    startScreenshotPolling();
    void get()
      .refreshBrowserSessions()
      .then(() => {
        const state = useStore.getState();
        const sessionId =
          state.selectedBrowserSessionId ?? state.browserSessions[0]?.id;
        if (sessionId) void state.refreshScreenshot(sessionId).catch(() => {});
      })
      .catch(() => {});
  },

  selectBrowserSession(id) {
    set({ selectedBrowserSessionId: id });
    if (get().screenshotPolling) void get().refreshScreenshot(id).catch(() => {});
  },

  async listFiles(path) {
    const response = await api.executorTool("files.list", { path });
    if (!response.ok) throw new Error(response.error ?? "files.list failed");
    const data = response.data as { entries?: FilesEntry[] } | undefined;
    set({
      filesPath: path,
      filesEntries: data?.entries ?? [],
      filesContent: null,
    });
  },

  async readFile(path) {
    const response = await api.executorTool("files.read", { path });
    if (!response.ok) throw new Error(response.error ?? "files.read failed");
    const data = response.data as
      | { content?: string; encoding?: string }
      | undefined;
    set({
      filesContent: {
        path,
        content: data?.content ?? "",
        encoding: data?.encoding,
      },
    });
  },

  async navigateActivity(path) {
    await get().listFiles(path);
  },

  async createAgent(input) {
    const agent = await api.createAgent(input);
    await get().refreshAgents();
    return agent;
  },

  async updateAgent(id, patch) {
    const agent = await api.updateAgent(id, patch);
    await get().refreshAgents();
    return agent;
  },

  async deleteAgent(id) {
    await api.deleteAgent(id);
    await get().refreshAgents();
  },

  async createConversation(agentId) {
    const conversation = await api.createConversation({ agentId });
    set({ conversations: upsertConversation(get().conversations, conversation) });
    return conversation;
  },

  async deleteConversation(id) {
    await api.deleteConversation(id);
    const conversations = get().conversations.filter((c) => c.id !== id);
    const messagesByConversation = { ...get().messagesByConversation };
    delete messagesByConversation[id];
    const streamingByConversation = { ...get().streamingByConversation };
    delete streamingByConversation[id];
    set({
      conversations,
      messagesByConversation,
      streamingByConversation,
      activeConversationId:
        get().activeConversationId === id ? null : get().activeConversationId,
    });
  },

  async loadConversation(id) {
    const detail = await api.conversation(id);
    set({
      activeConversationId: id,
      messagesByConversation: {
        ...get().messagesByConversation,
        [id]: detail.messages,
      },
    });
  },

  async sendMessage(conversationId, content, attachments) {
    const { message, task } = await api.sendMessage(conversationId, {
      content,
      attachments,
    });
    const existing = get().messagesByConversation[conversationId] ?? [];
    set({
      messagesByConversation: {
        ...get().messagesByConversation,
        [conversationId]: [...existing, message],
      },
      tasks: upsertTask(get().tasks, task),
    });
    await get().refreshConversations();
  },

  async uploadFile(file) {
    return api.uploadFile(file);
  },

  async cancelTask(taskId) {
    await api.cancelTask(taskId);
    await get().refreshTasks();
  },

  async updateSettings(patch) {
    set({ settings: await api.updateSettings(patch) });
  },

  async fetchMemories() {
    const { kind, q } = get().memoryFilter;
    set({
      memories: await api.memories(kind === "all" ? { q } : { kind, q }),
    });
  },

  setMemoryFilter(partial) {
    set({ memoryFilter: { ...get().memoryFilter, ...partial } });
  },

  async addMemory(body) {
    await api.createMemory(body);
    await get().fetchMemories();
  },

  async editMemory(id, patch) {
    await api.patchMemory(id, patch);
    await get().fetchMemories();
  },

  async forgetMemory(id) {
    await api.deleteMemory(id);
    await get().fetchMemories();
  },

  async fetchSkills() {
    const result = await api.skills();
    set({ skills: result.skills, skillsSupported: result.supported });
  },

  async installSkill(source) {
    await api.installSkill(source);
    await get().fetchSkills();
  },

  async removeSkill(name) {
    await api.deleteSkill(name);
    await get().fetchSkills();
  },

  async runSkillTests(name) {
    const result = await api.testSkill(name);
    return result.results;
  },

  async fetchRoutines() {
    set({ routines: await api.routines() });
  },

  async createRoutine(body) {
    const routine = await api.createRoutine(body);
    await get().fetchRoutines();
    return routine;
  },

  async updateRoutine(id, patch) {
    const routine = await api.updateRoutine(id, patch);
    await get().fetchRoutines();
    return routine;
  },

  async deleteRoutine(id) {
    await api.deleteRoutine(id);
    await get().fetchRoutines();
  },

  async runRoutine(id) {
    const run = await api.runRoutine(id);
    set({ routineRuns: [run, ...get().routineRuns] });
  },

  async testRoutine(id) {
    const run = await api.testRoutine(id);
    set({ routineRuns: [run, ...get().routineRuns] });
  },

  async fetchRoutineRuns(routineId) {
    const runs = routineId
      ? await api.routineRuns(routineId)
      : await api.allRoutineRuns();
    set({ routineRuns: runs });
  },

  async fetchA2aAgents() {
    set({ a2aAgents: await api.a2aAgents() });
  },

  async fetchArtifacts() {
    set({ artifacts: await api.artifacts() });
  },

  async exportData() {
    return api.exportData();
  },

  async importData(data) {
    const res = await api.importData(data);
    await get().loadAll();
    return res.imported;
  },

  handleWsEvent(raw) {
    if (typeof raw !== "object" || raw === null) return;
    const event = raw as ServerEvent;
    switch (event.type) {
      case "hello": {
        set({
          connected: true,
          agents: event.state.agents,
          conversations: event.state.conversations,
          tasks: event.state.tasks,
          workers: event.state.workers,
          settings: event.state.settings,
        });
        void get().refreshTools();
        void get().fetchSecurityStatus().catch(() => {});
        void get().fetchApprovals();
        void get().fetchConnectors();
        void get().fetchOauthProviders();
        void get().fetchMcpServers();
        void get().fetchMemories().catch(() => {});
        void get().fetchSkills().catch(() => {});
        void get().fetchRoutines().catch(() => {});
        void get().fetchRoutineRuns().catch(() => {});
        void get().fetchA2aAgents().catch(() => {});
        void get().fetchArtifacts().catch(() => {});
        return;
      }
      case "conversation.created":
        set({
          conversations: upsertConversation(
            get().conversations,
            event.conversation as ConversationSummary
          ),
        });
        return;
      case "message.delta": {
        const prev = get().streamingByConversation[event.conversationId];
        const updatedBuffer: StreamingBuffer = {
          messageId: event.messageId,
          text: (prev?.text ?? "") + event.delta,
        };
        set({
          streamingByConversation: {
            ...get().streamingByConversation,
            [event.conversationId]: updatedBuffer,
          },
        });
        return;
      }
      case "message.completed": {
        set((state) => {
          const streamingByConversation = { ...state.streamingByConversation };
          delete streamingByConversation[event.conversationId];
          if (!event.message.content) {
            return { streamingByConversation };
          }
          const existing = state.messagesByConversation[event.conversationId] ?? [];
          return {
            streamingByConversation,
            messagesByConversation: {
              ...state.messagesByConversation,
              [event.conversationId]: [...existing, event.message],
            },
          };
        });
        void get().refreshTasks();
        void get().refreshConversations();
        return;
      }
      case "task.created":
      case "task.updated":
        set({ tasks: upsertTask(get().tasks, event.task) });
        return;
      case "worker.online":
        set({ workers: upsertWorker(get().workers, event.worker) });
        return;
      case "worker.offline":
        set({ workers: upsertWorker(get().workers, { ...event.worker, online: false }) });
        return;
      case "settings.updated":
        set({ settings: event.settings });
        void get().fetchApprovals();
        void get().fetchConnectors();
        void get().fetchOauthProviders();
        void get().fetchMcpServers();
        void get().fetchMemories().catch(() => {});
        void get().fetchSkills().catch(() => {});
        return;
      case "approval.requested":
        set({ approvals: [event.approval, ...get().approvals] });
        return;
      case "approval.decided":
        set({
          approvals: get().approvals.map((a) =>
            a.id === event.approval.id ? event.approval : a
          ),
        });
        return;
      case "connector.connected": {
        const connector: ConnectorView = {
          ...event.connector,
          providerLabel:
            get().oauthProviders.find((p) => p.id === event.connector.provider)
              ?.label ?? event.connector.provider,
          updatedAt: event.connector.createdAt,
        };
        set({
          connectors: [
            connector,
            ...get().connectors.filter((c) => c.id !== connector.id),
          ],
        });
        return;
      }
      case "connector.removed":
        set({
          connectors: get().connectors.filter((c) => c.id !== event.connectorId),
        });
        return;
      case "routine.run":
        set({
          routineRuns: [
            event.run,
            ...get().routineRuns.filter((r) => r.id !== event.run.id),
          ],
        });
        void get().fetchRoutines().catch(() => {});
        return;
      case "step.started":
      case "tool.started":
      case "tool.completed":
        return;
    }
  },
}));
