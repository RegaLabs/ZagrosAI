import { newId, now, type Agent, type Artifact, type Conversation, type Message } from "@zagros/domain";
import { createAgentCard } from "@zagros/a2a";
import { toolFromZod, type ToolContext, type ToolDefinition } from "@zagros/tools";
import { z } from "zod";
import type { Kernel } from "./kernel.js";

const DELEGATE_TIMEOUT_MS = 10 * 60 * 1000;

export function createDelegateTool(kernel: Kernel): ToolDefinition {
  return toolFromZod({
    id: "agent.delegate",
    provider: "native",
    description:
      "Delegate a task to another Zagros agent (by id or by group) and wait for its result. Use for work that benefits from a specialized agent, separate context or different model. Returns the delegated agent's final answer.",
    risk: "R1",
    idempotent: false,
    schema: z
      .object({
        agentId: z.string().optional(),
        group: z.string().optional(),
        task: z.string().min(1).max(2000),
        note: z.string().optional(),
      })
      .refine((v: { agentId?: string; group?: string }) => v.agentId || v.group, { message: "either agentId or group is required" }),
    execute: async (rawArgs, ctx?: ToolContext) => {
      const args = rawArgs as { agentId?: string; group?: string; task: string; note?: string };
      let target: Agent | undefined;
      if (args.agentId) {
        target = await kernel.repos.getAgent(args.agentId);
      } else if (args.group) {
        target = await pickGroupAgent(kernel, args.group);
      }
      if (!target) {
        return { ok: false, error: `No agent found for delegation (${args.agentId ?? `group:${args.group}`}).` };
      }
      try {
        const timestamp = now();
        const title = `Delegated: ${args.task.slice(0, 60)}`;
        const conversation: Conversation = {
          id: newId("conv"),
          title,
          agentId: target.id,
          userId: "delegate",
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await kernel.repos.saveConversation(conversation);
        const userMessage: Message = {
          id: newId("msg"),
          conversationId: conversation.id,
          agentId: target.id,
          role: "user",
          content: `${args.task}${args.note ? `\n\nContext: ${args.note}` : ""}`,
          attachments: [],
          createdAt: timestamp,
        };
        await kernel.repos.saveMessage(userMessage);
        const task = await kernel.startRun(conversation, target, userMessage, ctx?.requestId);
        const result = await withTimeout(kernel.waitForRun(task.id), DELEGATE_TIMEOUT_MS);
        const messages = await kernel.repos.listMessages(conversation.id);
        const reply = [...messages].reverse().find((m) => m.role === "assistant" && m.content)?.content ?? "";
        if (result && result.status === "completed") {
          return {
            ok: true,
            data: { agentId: target.id, agentName: target.name, conversationId: conversation.id, result: reply.slice(0, 4000) },
          };
        }
        return {
          ok: false,
          error: `Delegated agent ${target.name} finished with status "${result?.status ?? "timeout"}": ${result?.error ?? "no result"}`,
          data: { agentId: target.id, conversationId: conversation.id, result: reply.slice(0, 2000) },
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}

export function createArtifactTools(kernel: Kernel): ToolDefinition[] {
  const artifactSave = toolFromZod({
    id: "artifact.save",
    provider: "native",
    description:
      "Store a shared artifact under a key so other agents can retrieve it with artifact.get. The value is stored as text (JSON-stringify structured data).",
    risk: "R1",
    idempotent: true,
    schema: z.object({ key: z.string().min(1).max(200), value: z.string() }),
    execute: async (rawArgs, ctx: ToolContext) => {
      const args = rawArgs as { key: string; value: string };
      const timestamp = now();
      const artifact: Artifact = {
        id: newId("art"),
        key: args.key,
        value: args.value,
        agentId: ctx.agentId,
        conversationId: ctx.conversationId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await kernel.repos.saveArtifact(artifact);
      return { ok: true, data: { key: args.key, stored: true } };
    },
  });

  const artifactGet = toolFromZod({
    id: "artifact.get",
    provider: "native",
    description: "Retrieve a shared artifact stored earlier with artifact.save.",
    risk: "R0",
    idempotent: true,
    schema: z.object({ key: z.string().min(1).max(200) }),
    execute: async (rawArgs) => {
      const args = rawArgs as { key: string };
      const artifact = await kernel.repos.getArtifact(args.key);
      if (!artifact) return { ok: false, error: `Artifact not found: ${args.key}` };
      return { ok: true, data: { key: artifact.key, value: artifact.value, updatedAt: artifact.updatedAt } };
    },
  });

  return [artifactSave, artifactGet];
}

export function createA2aCallTool(kernel: Kernel): ToolDefinition {
  return toolFromZod({
    id: "a2a.call",
    provider: "native",
    description:
      "Call an external A2A agent. Discovers its Agent Card (GET {url}/.well-known/agent.json), sends the message via JSON-RPC message/send, and returns the remote agent's reply. The remote agent runs its own tools on its own infrastructure.",
    risk: "R2",
    idempotent: false,
    schema: z.object({
      url: z.string().url(),
      message: z.string().min(1).max(2000),
      timeoutMs: z.number().int().min(1000).max(180000).default(120000),
    }),
    execute: async (rawArgs) => {
      const args = rawArgs as { url: string; message: string; timeoutMs?: number };
      try {
        const result = await a2aSendMessage(args.url, args.message, args.timeoutMs ?? 120_000);
        return { ok: true, data: result };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}

export async function a2aSendMessage(baseUrl: string, message: string, timeoutMs: number): Promise<{ agentName: string; reply: string }> {
  const base = baseUrl.replace(/\/+$/, "");
  const cardUrl = `${base}/.well-known/agent.json`;
  const cardRes = await fetch(cardUrl, { signal: AbortSignal.timeout(15_000) });
  if (!cardRes.ok) {
    throw new Error(`A2A Agent Card not found at ${cardUrl} (HTTP ${cardRes.status}).`);
  }
  const card = (await cardRes.json()) as { name?: string; url?: string };
  const jsonrpcBase = (card.url ?? base).replace(/\/+$/, "");
  const endpoint = `${jsonrpcBase}/jsonrpc`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `zagros-${newId("a2a")}`,
      method: "message/send",
      params: {
        message: {
          role: "user",
          parts: [{ kind: "text", text: message }],
        },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`A2A message/send failed (HTTP ${response.status}): ${text.slice(0, 300)}`);
  }
  const json = (await response.json()) as {
    result?: {
      message?: { parts?: Array<{ kind?: string; text?: string }> };
      status?: string;
      error?: { message?: string };
    };
    error?: { message?: string };
  };
  if (json.error) throw new Error(`A2A error: ${json.error.message ?? "unknown"}`);
  const result = json.result;
  if (!result) throw new Error("A2A message/send: empty result");
  if (result.error) throw new Error(`A2A agent error: ${result.error.message ?? "unknown"}`);
  const reply = (result.message?.parts ?? [])
    .filter((part) => part.kind === "text" && part.text)
    .map((part) => part.text)
    .join("\n");
  return { agentName: card.name ?? "remote-agent", reply: reply.slice(0, 8000) };
}

export function buildAgentCard(kernel: Kernel, agent: Agent, baseUrl: string): Record<string, unknown> {
  return createAgentCard(agent, baseUrl) as unknown as Record<string, unknown>;
}

export async function getSubtaskDecompositionGraph(kernel: Kernel, rootTaskId: string) {
  const allTasks = await kernel.repos.listTasks(500);
  const taskMap = new Map(allTasks.map((t) => [t.id, t]));
  const nodes: Array<{
    taskId: string;
    agentId: string;
    conversationId: string;
    status: string;
    parentTaskId?: string;
    subtaskIds: string[];
  }> = [];
  const queue = [rootTaskId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    const task = taskMap.get(currentId);
    if (!task) continue;

    const childTasks = allTasks.filter((t) => t.parentTaskId === task.id).map((t) => t.id);
    const subtaskIds = Array.from(new Set([...(task.subtaskIds ?? []), ...childTasks]));
    nodes.push({
      taskId: task.id,
      agentId: task.agentId,
      conversationId: task.conversationId,
      status: task.status,
      parentTaskId: task.parentTaskId,
      subtaskIds,
    });

    for (const subId of subtaskIds) {
      if (!visited.has(subId)) queue.push(subId);
    }
  }

  return nodes;
}

export async function handleA2aJsonRpc(kernel: Kernel, agent: Agent, body: unknown, baseUrl: string): Promise<unknown> {
  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const id = record.id;
  const method = record.method;
  const params = (typeof record.params === "object" && record.params !== null ? record.params : {}) as Record<string, unknown>;
  const wrap = (result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
  const fail = (message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code: -32603, message } });

  if (method === "agent/get" || method === "agent/ping") {
    return wrap(method === "agent/get" ? buildAgentCard(kernel, agent, baseUrl) : { ok: true });
  }
  if (method === "message/send") {
    const message = (typeof params.message === "object" && params.message !== null ? params.message : {}) as Record<string, unknown>;
    const parts = Array.isArray(message.parts) ? message.parts : [];
    const text = parts
      .filter((part): part is Record<string, unknown> => typeof part === "object" && part !== null)
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("\n");
    if (!text) return fail("message/send requires a text part");
    try {
      const reply = await runA2aMessage(kernel, agent, text, params.sessionId);
      return wrap({
        id: newId("a2amsg"),
        sessionId: params.sessionId ?? "session-1",
        role: "agent",
        kind: "message",
        parts: [{ kind: "text", text: reply }],
        contextId: newId("a2actx"),
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }
  return { jsonrpc: "2.0", id: id ?? null, error: { code: -32601, message: `method not found: ${String(method)}` } };
}

async function runA2aMessage(kernel: Kernel, agent: Agent, text: string, sessionKey: unknown): Promise<string> {
  const timestamp = now();
  const title = "A2A exchange";
  const conversations = await kernel.repos.listConversations();
  let conversation = conversations.find((c) => c.title === title && c.agentId === agent.id && c.userId === "a2a");
  if (!conversation) {
    conversation = {
      id: newId("conv"),
      title,
      agentId: agent.id,
      userId: "a2a",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await kernel.repos.saveConversation(conversation);
  }
  const userMessage: Message = {
    id: newId("msg"),
    conversationId: conversation.id,
    agentId: agent.id,
    role: "user",
    content: text,
    attachments: [],
    createdAt: timestamp,
  };
  await kernel.repos.saveMessage(userMessage);
  const task = await kernel.startRun(conversation, agent, userMessage);
  const result = await withTimeout(kernel.waitForRun(task.id), 120_000);
  if (!result || result.status !== "completed") {
    throw new Error(`A2A agent task ${result?.status ?? "timed out"}: ${result?.error ?? "no result"}`);
  }
  void sessionKey;
  const messages = await kernel.repos.listMessages(conversation.id);
  return [...messages].reverse().find((m) => m.role === "assistant" && m.content)?.content ?? "";
}

async function pickGroupAgent(kernel: Kernel, group: string): Promise<Agent | undefined> {
  const agents = await kernel.repos.listAgents();
  const members = agents.filter((a) => a.group === group);
  if (members.length === 0) return undefined;
  const tasks = await kernel.repos.listTasks(500);
  const active = tasks.filter((t) => t.status === "running" || t.status === "queued" || t.status === "waiting_for_tool" || t.status === "waiting_for_approval");
  const load = new Map<string, number>();
  for (const task of active) {
    load.set(task.agentId, (load.get(task.agentId) ?? 0) + 1);
  }
  return [...members].sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))[0];
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
        const unref = (timer as { unref?: () => void }).unref;
        if (unref) unref.call(timer);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
