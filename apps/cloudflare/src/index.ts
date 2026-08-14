import { Kernel, buildHttpRoutes, type HttpContext, type HttpReply } from "@zagros/kernel";
import { registerConnectors } from "@zagros/connectors";
import { newId, now, type Agent, type Conversation, type Message, type Task } from "@zagros/domain";
import { D1Repos } from "./d1-repos.js";
import { R2ObjectStore } from "./r2-store.js";
import { PushService, type PushSubscriptionRecord } from "./push.js";
import type { Env } from "./env.js";

export { Hub } from "./hub.js";
export { ScheduledTaskWorkflow } from "./workflow.js";

const JSON_HEADERS = { "content-type": "application/json" };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/uploads/")) {
      const key = decodeURIComponent(url.pathname.slice("/uploads/".length));
      const obj = await env.FILES.get(key);
      if (!obj) return new Response("not found", { status: 404 });
      return new Response(obj.body, {
        headers: {
          "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
          "cache-control": "public, max-age=31536000",
        },
      });
    }

    if (url.pathname === "/ws" || url.pathname === "/ws/runner") {
      const id = env.HUB.idFromName("global");
      const stub = env.HUB.get(id);
      return stub.fetch(request);
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, url, env);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function handleApi(request: Request, url: URL, env: Env): Promise<Response> {
  const repos = new D1Repos(env.DB);
  await repos.ensureSchema();
  const objects = new R2ObjectStore(env.FILES);
  const kernel = new Kernel(
    {
      defaultWorkspace: "",
      version: env.VERSION,
      stdioMcpEnabled: false,
      masterKey: env.ZAGROS_MASTER_KEY,
      publicBaseUrl: env.MAIN_URL ?? url.origin,
    },
    repos,
    objects
  );
  registerConnectors(kernel, {
    google: {
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    },
    github: {
      clientId: env.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
    },
  });
  await kernel.init();
  kernel.approvalDecideDelegate = async (approvalId: string, decision: string): Promise<boolean> => {
    const id = env.HUB.idFromName("global");
    const res = await env.HUB
      .get(id)
      .fetch("https://hub/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalId, decision }),
      });
    const body = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean };
    return body.ok === true;
  };
  kernel.toolExecuteDelegate = async (toolId: string, toolArgs: unknown) => {
    const id = env.HUB.idFromName("global");
    const res = await env.HUB
      .get(id)
      .fetch("https://hub/tool-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolId, args: toolArgs }),
      });
    const body = (await res.json().catch(() => ({ ok: false, error: "hub unavailable" }))) as {
      ok?: boolean;
      data?: unknown;
      error?: string;
      workerId?: string;
    };
    return { ok: body.ok === true, data: body.data, error: body.error, workerId: body.workerId };
  };
  kernel.scheduleRoutineWakeupDelegate = async () => {
    const id = env.HUB.idFromName("global");
    await env.HUB.get(id).fetch("https://hub/routine-alarm", { method: "POST" });
  };
  kernel.pauseTaskDelegate = async (taskId: string, paused: boolean): Promise<boolean> => {
    const id = env.HUB.idFromName("global");
    const res = await env.HUB
      .get(id)
      .fetch("https://hub/pause", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId, paused }),
      });
    const body = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean };
    return body.ok === true;
  };

  kernel.startRunDelegate = async (conversation: Conversation, agent: Agent, userMessage: Message): Promise<Task> => {
    const task: Task = {
      id: newId("task"),
      conversationId: conversation.id,
      messageId: userMessage.id,
      agentId: agent.id,
      status: "queued",
      steps: [],
      modelCalls: 0,
      toolCalls: 0,
      paused: false,
      createdAt: now(),
    };
    await repos.saveTask(task);
    await repos.touchConversation(conversation.id, now());
    const id = env.HUB.idFromName("global");
    const stub = env.HUB.get(id);
    void stub
      .fetch("https://hub/task", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: conversation.id, messageId: userMessage.id }),
      })
      .catch(() => {});
    return task;
  };

  kernel.cancelTaskDelegate = (taskId: string): boolean => {
    const id = env.HUB.idFromName("global");
    void env.HUB
      .get(id)
      .fetch("https://hub/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId }),
      })
      .catch(() => {});
    return true;
  };

  if (url.pathname === "/api/routines/once" && request.method === "POST") {
    const parsed = (await request.json().catch(() => null)) as { conversationId?: string; content?: string; at?: string } | null;
    if (!parsed?.conversationId || !parsed?.content || !parsed?.at) return json({ error: "missing_fields" }, 400);
    if (isNaN(Date.parse(parsed.at))) return json({ error: "invalid_date" }, 400);
    const conversation = await repos.getConversation(parsed.conversationId);
    if (!conversation) return json({ error: "conversation_not_found" }, 404);
    const agent = await repos.getAgent(conversation.agentId);
    if (!agent) return json({ error: "agent_not_found" }, 500);
    const message: Message = {
      id: newId("msg"),
      conversationId: conversation.id,
      agentId: agent.id,
      role: "user",
      content: parsed.content,
      attachments: [],
      createdAt: now(),
    };
    await repos.saveMessage(message);
    const instance = await env.WORKFLOW.create({
      params: { conversationId: conversation.id, messageId: message.id, at: parsed.at, baseUrl: env.MAIN_URL ?? url.origin },
    });
    return json({ ok: true, workflowId: instance.id, messageId: message.id });
  }

  if (url.pathname === "/api/routines/run" && request.method === "POST") {
    const parsed = (await request.json().catch(() => null)) as { conversationId?: string; messageId?: string } | null;
    if (!parsed?.conversationId || !parsed?.messageId) return json({ error: "missing_fields" }, 400);
    const id = env.HUB.idFromName("global");
    const stub = env.HUB.get(id);
    await stub.fetch("https://hub/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: parsed.conversationId, messageId: parsed.messageId }),
    });
    return json({ ok: true });
  }

  if (url.pathname === "/api/push/subscribe" && request.method === "POST") {
    const parsed = (await request.json().catch(() => null)) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | null;
    if (!parsed?.endpoint || !parsed.keys?.p256dh || !parsed.keys?.auth) return json({ error: "invalid_subscription" }, 400);
    const push = new PushService(env.DB, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    const record: PushSubscriptionRecord = {
      endpoint: parsed.endpoint,
      keys: { p256dh: parsed.keys.p256dh, auth: parsed.keys.auth },
      createdAt: now(),
    };
    await push.subscribe(record);
    return json({ ok: true });
  }

  if (url.pathname === "/api/push/unsubscribe" && request.method === "POST") {
    const parsed = (await request.json().catch(() => null)) as { endpoint?: string } | null;
    if (!parsed?.endpoint) return json({ error: "missing_endpoint" }, 400);
    const push = new PushService(env.DB, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    await push.unsubscribe(parsed.endpoint);
    return json({ ok: true });
  }

  if (url.pathname === "/api/push/test" && request.method === "POST") {
    const push = new PushService(env.DB, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    const result = await push.sendToAll("Zagros test", "Push notifications are working");
    return json({ ok: true, ...result });
  }

  const table = buildHttpRoutes(kernel);
  table.get.set("/api/workers", async () => {
    const id = env.HUB.idFromName("global");
    const res = await env.HUB.get(id).fetch("https://hub/workers");
    return { status: res.status, body: await res.json() };
  });
  const method = request.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
  const routesForMethod = table[method];
  if (!routesForMethod) return json({ error: "method_not_allowed" }, 405);
  const matched = executeRoute(routesForMethod, url.pathname);
  if (!matched) return json({ error: "not_found" }, 404);

  let body: unknown;
  let upload: { name: string; mimeType?: string; data: Uint8Array } | undefined;
  if (url.pathname === "/api/uploads") {
    const formData = await request.formData().catch(() => undefined);
    const file = formData?.get("file");
    if (file instanceof File) {
      upload = {
        name: file.name,
        mimeType: file.type || undefined,
        data: new Uint8Array(await file.arrayBuffer()),
      };
    }
  } else if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
    body = await request.json().catch(() => undefined);
  }

  const ctx: HttpContext = {
    params: matched.params,
    query: searchParamsToRecord(url.searchParams),
    body,
    headers: headersToRecord(request.headers),
    upload,
    ip: request.headers.get("cf-connecting-ip") ?? "cloud",
  };
  const reply: HttpReply = await matched.handler(ctx);
  const responseHeaders: Record<string, string> = { ...JSON_HEADERS, ...(reply.headers ?? {}) };
  if (reply.raw) {
    return new Response(reply.body as string, { status: reply.status, headers: responseHeaders });
  }
  return json(reply.body, reply.status);
}

function searchParamsToRecord(searchParams: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function matchRoute(path: string, pattern: string): Record<string, string> | undefined {
  const pathParts = path.split("/").filter((part) => part.length > 0);
  const patternParts = pattern.split("/").filter((part) => part.length > 0);
  if (pathParts.length !== patternParts.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const patternPart = patternParts[i]!;
    const pathPart = pathParts[i]!;
    if (patternPart.startsWith(":")) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
    } else if (patternPart.toLowerCase() !== pathPart.toLowerCase()) {
      return undefined;
    }
  }
  return params;
}

function executeRoute(
  routes: Map<string, (ctx: HttpContext) => Promise<HttpReply>> | undefined,
  path: string
): { handler: (ctx: HttpContext) => Promise<HttpReply>; params: Record<string, string> } | undefined {
  if (!routes) return undefined;
  const normalizedPath = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
  const exact = routes.get(normalizedPath) ?? routes.get(path);
  if (exact) return { handler: exact, params: {} };
  for (const [pattern, handler] of routes) {
    const params = matchRoute(normalizedPath, pattern);
    if (params) return { handler, params };
  }
  return undefined;
}
