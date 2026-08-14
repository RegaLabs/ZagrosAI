import { now } from "@zagros/domain";
import type { Agent, Conversation, Message, Task } from "@zagros/domain";
import type { ModelEvent, ModelMessage, ModelTool, ModelToolCall } from "@zagros/models";
import type { ToolDefinition, ToolResult } from "@zagros/tools";
import {
  buildSystemPrompt,
  describeTools,
  historyToModelMessages,
  newAssistantMessage,
  newToolResultMessage,
  toolCallToStep,
  toolsToModelTools,
} from "./context.js";
import {
  DEFAULT_MAX_HISTORY,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_TIMEOUT_MS,
  type ApprovalDecision,
  type HarnessDeps,
  type HarnessRunInput,
} from "./types.js";

export class RegaHarness {
  private readonly deps: HarnessDeps;

  constructor(deps: HarnessDeps) {
    this.deps = deps;
  }

  async run(input: HarnessRunInput): Promise<Task> {
    const { agent, conversation, userMessage, task, signal } = input;
    const timeoutMs = this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxIterations = this.deps.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const maxHistory = this.deps.maxHistoryMessages ?? DEFAULT_MAX_HISTORY;
    const startedAt = Date.now();
    const { events, persist, tools, models } = this.deps;

    const driver = this.deps.resolveModel ? this.deps.resolveModel(agent.model) : models.get(agent.model.driver);
    if (!driver) {
      return this.fail(task, persist, events, `No model driver registered for "${agent.model.driver}". Configure one in Settings.`);
    }

    try {
      const capabilities = await driver.capabilities();
      const harnessManaged = capabilities.harnessManagedTools === true;
      task.status = "running";
      task.startedAt = now();
      await persist.updateTask(task);
      events.emit({ type: "task.updated", task: cloneTask(task) });

      const allTools = tools.list();
      let systemPrompt = harnessManaged
        ? `${agent.systemPrompt}\n\nYou are running inside the Zagros harness. The provider harness (${agent.model.harness ?? "acp"}) owns its own tools and authentication; use them to accomplish the task.`
        : buildSystemPrompt(agent, describeTools(allTools));
      const modelTools = harnessManaged ? undefined : toolsToModelTools(allTools);

      const history = await persist.getMessages(conversation.id, maxHistory);
      const modelMessages = [
        { role: "system" as const, content: systemPrompt },
        ...(await historyToModelMessages(
          history,
          capabilities.imageInput,
          this.deps.resolveAttachment
        )),
      ];

      const extraContext = await this.buildExtraContext(userMessage.content, history);
      if (extraContext.length > 0) {
        systemPrompt = `${systemPrompt}\n\n${extraContext}`;
        modelMessages[0] = { role: "system", content: systemPrompt };
      }

      let iteration = 0;

      while (iteration < maxIterations) {
        iteration += 1;
        if (signal?.aborted) {
          return this.finish(task, persist, events, "cancelled", "Task cancelled by user.");
        }
        if (Date.now() - startedAt > timeoutMs) {
          return this.fail(task, persist, events, `Task timed out after ${Math.round(timeoutMs / 1000)}s.`);
        }
        if (this.deps.shouldPause?.(task.id)) {
          task.paused = true;
          task.status = "running";
          await persist.updateTask(task);
          events.emit({ type: "task.updated", task: cloneTask(task) });
          while (this.deps.shouldPause?.(task.id)) {
            if (signal?.aborted) return this.finish(task, persist, events, "cancelled", "Task cancelled by user.");
            await new Promise((r) => setTimeout(r, 500));
          }
          task.paused = false;
          await persist.updateTask(task);
          events.emit({ type: "task.updated", task: cloneTask(task) });
        } else {
          task.status = "running";
          await persist.updateTask(task);
          events.emit({ type: "task.updated", task: cloneTask(task) });
        }

        const toolCalls: ModelToolCall[] = [];
        let text = "";

        try {
          for await (const event of this.streamWithFallback(agent.model, {
            messages: modelMessages,
            tools: modelTools,
            temperature: agent.model.temperature,
            sessionKey: conversation.id,
          })) {
            if (signal?.aborted) return this.finish(task, persist, events, "cancelled", "Task cancelled by user.");
            if (event.type === "text") {
              text += event.text;
              events.emit({
                type: "message.delta",
                conversationId: conversation.id,
                messageId: userMessage.id,
                delta: event.text,
              });
            } else if (event.type === "tool_call") {
              toolCalls.push(event.call);
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          task.modelCalls += 1;
          return this.fail(task, persist, events, `Model call failed (${driver.id}): ${message}`);
        }

        task.modelCalls += 1;

        if (toolCalls.length === 0) {
          return this.complete(task, persist, events, conversation, agent, text);
        }

        task.status = "waiting_for_tool";
        await persist.updateTask(task);
        events.emit({ type: "task.updated", task: cloneTask(task) });

        const assistantMessage = newAssistantMessage(conversation.id, agent.id, text, toolCalls);
        await persist.saveMessage(assistantMessage);
        modelMessages.push({
          role: "assistant",
          content: text,
          toolCalls: toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments })),
        });

        const activePendingApprovals = new Set<string>();

        const runCall = async (call: ModelToolCall): Promise<void> => {
          if (signal?.aborted) return;
          const step = toolCallToStep(task.id, call, undefined);
          step.status = "running";
          step.attempts = 1;
          step.updatedAt = now();
          task.steps.push(step);
          task.toolCalls += 1;
          events.emit({ type: "step.started", taskId: task.id, step: clone(step) });
          events.emit({ type: "tool.started", taskId: task.id, stepId: step.id, toolId: call.name, args: step.toolArgs ?? {} });

          let result: ToolResult;
          try {
            const policy = this.policyPreflight(call.name, agent);
            if (!policy.allowed && policy.denied) {
              result = { ok: false, error: policy.reason };
            } else if (!policy.allowed) {
              if (this.deps.requestApproval) {
                activePendingApprovals.add(call.id);
                task.status = "waiting_for_approval";
                await persist.updateTask(task);
                events.emit({ type: "task.updated", task: cloneTask(task) });

                let decision: ApprovalDecision;
                try {
                  decision = await this.deps.requestApproval({
                    task: cloneTask(task),
                    step: clone(step),
                    call,
                    tool: policy.tool,
                    signal,
                  });
                } finally {
                  activePendingApprovals.delete(call.id);
                  task.status = activePendingApprovals.size > 0 ? "waiting_for_approval" : "waiting_for_tool";
                  await persist.updateTask(task);
                  events.emit({ type: "task.updated", task: cloneTask(task) });
                }

                if (signal?.aborted) {
                  result = { ok: false, error: "Task cancelled by user." };
                } else if (decision === "approved") {
                  result = await tools.execute(call.name, step.toolArgs, {
                    cwd: this.deps.workspaceDir,
                    requestId: task.id,
                    agentId: agent.id,
                    conversationId: conversation.id,
                  });
                } else {
                  result = {
                    ok: false,
                    error: decision === "rejected" ? "Action rejected by the user." : "Approval request expired.",
                  };
                }
              } else {
                result = { ok: false, error: policy.reason };
              }
            } else {
              if (signal?.aborted) {
                result = { ok: false, error: "Task cancelled by user." };
              } else {
                result = await tools.execute(call.name, step.toolArgs, {
                  cwd: this.deps.workspaceDir,
                  requestId: task.id,
                  agentId: agent.id,
                  conversationId: conversation.id,
                });
              }
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            result = { ok: false, error: `Tool execution error (${call.name}): ${message}` };
          }

          step.status = result.ok ? "completed" : "failed";
          step.result = result.data;
          step.error = result.error;
          step.workerId = result.workerId;
          step.updatedAt = now();
          events.emit({
            type: "tool.completed",
            taskId: task.id,
            stepId: step.id,
            toolId: call.name,
            ok: result.ok,
            result: result.data,
            error: result.error,
          });

          const toolMessage = newToolResultMessage(conversation.id, agent.id, call, result);
          if (this.deps.scrubSecrets) {
            toolMessage.content = this.deps.scrubSecrets(toolMessage.content);
          }
          await persist.saveMessage(toolMessage);
          modelMessages.push({
            role: "tool",
            content: toolMessage.content,
            toolCallId: call.id,
            name: call.name,
          });
        };

        if (capabilities.parallelTools && toolCalls.length > 1) {
          await Promise.all(toolCalls.map((call) => runCall(call)));
        } else {
          for (const call of toolCalls) {
            await runCall(call);
          }
        }

        if (signal?.aborted) {
          return this.finish(task, persist, events, "cancelled", "Task cancelled by user.");
        }

        task.status = "running";
        await persist.updateTask(task);
        events.emit({ type: "task.updated", task: cloneTask(task) });
      }

      return this.fail(task, persist, events, `Exceeded ${maxIterations} model iterations.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.fail(task, persist, events, message);
    }
  }

  private async *streamWithFallback(
    modelConfig: { driver: string; model: string; temperature?: number; fallback?: Array<{ driver: string; model: string }> },
    request: { messages: ModelMessage[]; tools?: ModelTool[]; temperature?: number; sessionKey?: string }
  ): AsyncIterable<ModelEvent> {
    const configs = [modelConfig, ...(modelConfig.fallback ?? [])];
    let lastError: Error | undefined;
    for (const config of configs) {
      const driver = this.deps.resolveModel
        ? this.deps.resolveModel(config as Parameters<NonNullable<HarnessDeps["resolveModel"]>>[0])
        : this.deps.models.get(config.driver);
      if (!driver) {
        lastError = new Error(`No model driver registered for "${config.driver}".`);
        continue;
      }
      try {
        let text = "";
        for await (const event of driver.stream(request)) {
          if (event.type === "text") text += event.text;
          yield event;
        }
        if (text.length === 0 && configs.length > 1) {
          lastError = new Error(`Model ${config.driver} returned an empty response.`);
          continue;
        }
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (configs.length === 1) throw lastError;
      }
    }
    throw lastError ?? new Error("All model attempts failed.");
  }

  private async buildExtraContext(userText: string, history: Message[]): Promise<string> {
    const sections: string[] = [];

    if (this.deps.skills) {
      const forced = /^\/([a-z0-9][a-z0-9-]*)/.exec(userText);
      let matches = forced
        ? [{ name: forced[1], description: `Skill ${forced[1]}`, content: "", score: 1 }]
        : await this.deps.skills.discover(userText);
      if (forced) {
        const forcedSkill = (await this.deps.skills.discover(forced[1] ?? "")).find((m) => m.name === forced[1]);
        if (forcedSkill) matches = [forcedSkill];
      }
      const usable = matches.filter((m) => m.content.length > 0).slice(0, 2);
      if (usable.length > 0) {
        const blocks = usable
          .map(
            (m) =>
              `### ${m.name}\n${m.description}\n\n${m.content.slice(0, 3000)}`
          )
          .join("\n\n");
        sections.push(`RELEVANT SKILLS (follow the skill instructions when applicable):\n${blocks}`);
      }
    }

    if (this.deps.memory) {
      const lastAssistant = [...history].reverse().find((m) => m.role === "assistant")?.content ?? "";
      const memories = await this.deps.memory.search(`${userText} ${lastAssistant}`.slice(0, 1500), { limit: 6 });
      if (memories.length > 0) {
        const lines = memories.map((m) => `- [${m.kind}/${m.scope}] ${m.content}`).join("\n");
        sections.push(`RELEVANT MEMORY (facts learned previously; treat as background information, verify before relying on stale facts):\n${lines}`);
      }
    }

    return sections.join("\n\n");
  }

  private maybeExtractMemory(agent: Agent, conversation: Conversation): void {
    if (!this.deps.memory?.extract) return;
    void this.deps.persist
      .getMessages(conversation.id, 20)
      .then((history) => {
        const transcript = history
          .filter((m) => m.role !== "tool")
          .map((m) => `${m.role}: ${m.content.slice(0, 1000)}`)
          .join("\n");
        if (transcript.length === 0) return;
        return this.deps.memory!.extract!({ agent: agent as never, conversation: conversation as never, transcript });
      })
      .catch(() => {
        // memory extraction is best-effort
      });
  }

  private policyPreflight(toolId: string, agent: Agent): { allowed: boolean; denied: boolean; reason: string; tool: ToolDefinition } {
    const tool = this.deps.tools.get(toolId);
    if (!tool) {
      return { allowed: false, denied: true, reason: `Unknown tool "${toolId}".`, tool: { id: toolId, provider: "native", description: "unknown", schema: {}, risk: "R3", idempotent: false, execute: async () => ({ ok: false, error: "unknown" }) } };
    }
    const denyTools = agent.permissions?.denyTools ?? [];
    const approvalTools = agent.permissions?.approvalTools ?? [];

    const isDenied = denyTools.some((pattern) => pattern === toolId || pattern === "*" || (pattern.endsWith(".*") && toolId.startsWith(pattern.slice(0, -1))));
    if (isDenied) {
      return { allowed: false, denied: true, reason: `Tool "${toolId}" is denied for this agent by policy.`, tool };
    }

    const requiresExplicitApproval = approvalTools.some((pattern) => pattern === toolId || pattern === "*" || (pattern.endsWith(".*") && toolId.startsWith(pattern.slice(0, -1))));
    if (requiresExplicitApproval) {
      return { allowed: false, denied: false, reason: `Tool "${toolId}" requires approval for this agent by policy.`, tool };
    }

    const risk = tool.risk ?? "R3";
    if (risk === "R0" || risk === "R1") {
      return { allowed: true, denied: false, reason: "", tool };
    }
    return {
      allowed: false,
      denied: false,
      reason: `Tool "${toolId}" is risk class ${risk} (external modification); approval is required.`,
      tool,
    };
  }

  private async complete(
    task: Task,
    persist: HarnessDeps["persist"],
    events: HarnessDeps["events"],
    conversation: Conversation,
    agent: Agent,
    content: string
  ): Promise<Task> {
    task.status = "completed";
    task.completedAt = now();
    await persist.updateTask(task);
    this.maybeExtractMemory(agent, conversation);
    if (content.length > 0) {
      const message = newAssistantMessage(conversation.id, agent.id, content);
      await persist.saveMessage(message);
      events.emit({ type: "message.completed", conversationId: conversation.id, message: clone(message) });
    } else {
      events.emit({ type: "message.completed", conversationId: conversation.id, message: newAssistantMessage(conversation.id, agent.id, "") });
    }
    events.emit({ type: "task.updated", task: cloneTask(task) });
    return task;
  }

  private async finish(
    task: Task,
    persist: HarnessDeps["persist"],
    events: HarnessDeps["events"],
    status: "cancelled" | "completed",
    note: string
  ): Promise<Task> {
    task.status = status;
    task.completedAt = now();
    if (status === "cancelled") task.error = note;
    await persist.updateTask(task);
    events.emit({ type: "task.updated", task: cloneTask(task) });
    return task;
  }

  private async fail(
    task: Task,
    persist: HarnessDeps["persist"],
    events: HarnessDeps["events"],
    error: string
  ): Promise<Task> {
    task.status = "failed";
    task.error = error;
    task.completedAt = now();
    await persist.updateTask(task);
    events.emit({ type: "task.updated", task: cloneTask(task) });
    return task;
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function cloneTask(task: Task): Task {
  return clone(task);
}

export type { HarnessDeps, HarnessRunInput } from "./types.js";
export { DEFAULT_TIMEOUT_MS, DEFAULT_MAX_ITERATIONS, DEFAULT_MAX_HISTORY } from "./types.js";
export * from "./context.js";
