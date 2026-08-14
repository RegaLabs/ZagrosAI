import { newId, now } from "@zagros/domain";
import type {
  Agent,
  Attachment,
  Conversation,
  Message,
  Task,
  TaskStep,
} from "@zagros/domain";
import type {
  ModelContentPart,
  ModelMessage,
  ModelTool,
  ModelToolCall,
} from "@zagros/models";
import type { ToolDefinition, ToolResult } from "@zagros/tools";
import type { AttachmentResolver } from "./types.js";

const MAX_TOOLS_IN_CONTEXT = 40;
const MAX_TOOL_DESCRIPTION_CHARS = 800;
const MAX_TOOL_RESULT_CHARS = 32_000;
const MAX_CONTEXT_PARTS = 8;

export function describeTools(tools: ToolDefinition[]): string {
  const visible = tools.slice(0, MAX_TOOLS_IN_CONTEXT).map((t) => ({
    name: t.id,
    description:
      t.description.length > MAX_TOOL_DESCRIPTION_CHARS
        ? t.description.slice(0, MAX_TOOL_DESCRIPTION_CHARS) + "…"
        : t.description,
    parameters: t.schema,
    risk: t.risk,
  }));
  return JSON.stringify(visible);
}

export function buildSystemPrompt(agent: Agent, toolList: string): string {
  return [
    agent.systemPrompt,
    "",
    "You are running inside the Zagros harness. Follow these rules:",
    "1. Use the provided tools to accomplish the task. Prefer tools over guessing.",
    "2. A tool result with ok=false is a failed attempt. Adjust and retry up to twice, then report honestly.",
    "3. Never claim an action succeeded without seeing a tool result.",
    "4. When you are done, write a concise summary of what you did and the outcome.",
    "",
    "AVAILABLE TOOLS:",
    toolList,
  ].join("\n");
}

async function attachmentToContentPart(
  attachment: Attachment,
  resolve?: AttachmentResolver
): Promise<ModelContentPart | undefined> {
  if (attachment.kind !== "image") return undefined;
  if (attachment.url) {
    return { type: "image", data: attachment.url, mimeType: attachment.mimeType };
  }
  if (attachment.path && resolve) {
    const resolved = await resolve(attachment);
    if (!resolved) return undefined;
    return { type: "image", data: resolved.data, mimeType: resolved.mimeType ?? attachment.mimeType };
  }
  return undefined;
}

export async function historyToModelMessages(
  messages: Message[],
  imageInput: boolean,
  resolve?: AttachmentResolver,
  maxParts = MAX_CONTEXT_PARTS
): Promise<ModelMessage[]> {
  const result: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const parts: ModelContentPart[] = [];
      if (message.content) parts.push({ type: "text", text: message.content });
      for (const attachment of message.attachments ?? []) {
        const part = await attachmentToContentPart(attachment, resolve);
        if (part) parts.push(part);
      }
      if (imageInput) {
        result.push({ role: "user", content: parts.slice(0, maxParts) });
      } else {
        const hasImage = parts.some((p) => p.type === "image");
        if (hasImage) {
          throw new Error(
            "Message contains an image but the selected model does not support image input. Enable image input in the agent's model settings or use a vision-capable model."
          );
        }
        result.push({ role: "user", content: parts });
      }
    } else if (message.role === "assistant") {
      const formattedCalls =
        message.toolCalls && message.toolCalls.length > 0
          ? message.toolCalls.map((tc) => ({
              id: tc.id,
              name: tc.name,
              arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments ?? {}),
            }))
          : undefined;
      result.push({
        role: "assistant",
        content: message.content,
        toolCalls: formattedCalls,
      });
    } else if (message.role === "tool") {
      result.push({
        role: "tool",
        content: truncateToolResult(message.content),
        toolCallId: message.toolCallId,
        name: message.toolName,
      });
    }
  }
  return result;
}

export function truncateToolResult(content: string): string {
  return content.length > MAX_TOOL_RESULT_CHARS
    ? content.slice(0, MAX_TOOL_RESULT_CHARS) + "\n…(truncated)"
    : content;
}

export function toolsToModelTools(tools: ToolDefinition[]): ModelTool[] {
  return tools.slice(0, MAX_TOOLS_IN_CONTEXT).map((t) => ({
    name: t.id,
    description: t.description,
    parameters: t.schema,
  }));
}

export function toolResultContent(result: ToolResult): string {
  const payload = result.ok ? (result.data ?? { ok: true }) : { error: result.error ?? "unknown tool failure" };
  let text = "";
  try {
    text = JSON.stringify(payload, null, 2);
  } catch {
    text = String(payload);
  }
  return truncateToolResult(text);
}

export function parseToolArgs(args: unknown): Record<string, unknown> {
  if (typeof args === "object" && args !== null && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args || "{}");
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { _raw: args };
    }
  }
  return {};
}

export function toolCallToStep(taskId: string, call: ModelToolCall, objective: string | undefined): TaskStep {
  const toolArgs = parseToolArgs(call.arguments);
  return {
    id: newId("step"),
    taskId,
    kind: "tool",
    objective,
    toolId: call.name,
    toolArgs,
    status: "pending",
    attempts: 0,
    createdAt: now(),
    updatedAt: now(),
  };
}

export function newAssistantMessage(
  conversationId: string,
  agentId: string,
  content: string,
  toolCalls?: ModelToolCall[]
): Message {
  return {
    id: newId("msg"),
    conversationId,
    agentId,
    role: "assistant",
    content,
    attachments: [],
    toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls.map((c) => ({
      id: c.id,
      name: c.name,
      arguments: parseToolArgs(c.arguments),
    })) : undefined,
    createdAt: now(),
  };
}

export function newToolResultMessage(
  conversationId: string,
  agentId: string,
  call: ModelToolCall,
  result: ToolResult
): Message {
  return {
    id: newId("msg"),
    conversationId,
    agentId,
    role: "tool",
    content: toolResultContent(result),
    attachments: [],
    toolCallId: call.id,
    toolName: call.name,
    createdAt: now(),
  };
}

export interface HistoryOptions {
  agent: Agent;
  conversation: Conversation;
}
