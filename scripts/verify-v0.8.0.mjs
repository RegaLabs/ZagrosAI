import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PORT = 8787;
const MOCK_PORT = 17000 + (Date.now() % 10000);
const WORKDIR = join(tmpdir(), `zagros-verify-v08-${Date.now()}`);
const SERVER_LOG = join(WORKDIR, "server.log");

const PASS = [];
const FAIL = [];

function check(name, condition, detail = "") {
  if (condition) {
    PASS.push(name);
    console.log(`  ok  ${name}`);
  } else {
    FAIL.push(name);
    console.log(`FAIL  ${name} ${detail ? "- " + detail : ""}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, timeoutMs, intervalMs = 400, label = "condition") {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for ${label}${last instanceof Error ? ` (${last.message})` : ""}`);
}

async function req(method, path, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function spawnModel(port, extraEnv) {
  return spawn("node", ["scripts/mock-model.mjs"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_MODEL_PORT: String(port), ...extraEnv },
    stdio: "ignore",
  });
}

function modelBaseUrl(port) {
  return `http://127.0.0.1:${port}/v1`;
}

async function waitTask(taskId, timeoutMs = 60000) {
  return waitFor(async () => {
    const t = await req("GET", `/api/tasks/${taskId}`);
    return t.data.status === "completed" || t.data.status === "failed" ? t.data : null;
  }, timeoutMs, 500, "task terminal");
}

async function main() {
  spawnSync("pkill", ["-f", "dist/index.js"], { stdio: "ignore" });
  spawnSync("pkill", ["-f", "mock-model"], { stdio: "ignore" });
  spawnSync("pkill", ["-f", "mock-a2a"], { stdio: "ignore" });
  await sleep(500);
  for (const killPort of [MOCK_PORT, MOCK_PORT + 1, MOCK_PORT + 2, MOCK_PORT + 3, MOCK_PORT + 4, MOCK_PORT + 5, MOCK_PORT + 6]) {
    spawnSync("bash", ["-c", `PIDS=$(ss -tlnp 2>/dev/null | grep ":$killPort " | grep -oP 'pid=\\K[0-9]+' | sort -u); for p in $PIDS; do kill -9 $p 2>/dev/null; done`], { stdio: "ignore" });
  }
  mkdirSync(WORKDIR, { recursive: true });
  console.log(`v0.8.0 verify workspace: ${WORKDIR}`);

  const memoryModel = spawnModel(MOCK_PORT + 1, { MOCK_FLOW: "memory", MOCK_REPLY: "subtask-ok" });
  const a2aModel = spawnModel(MOCK_PORT + 2, { MOCK_FLOW: "a2a", MOCK_A2A_URL: `http://127.0.0.1:${MOCK_PORT}` });
  const artifactModel = spawnModel(MOCK_PORT + 3, { MOCK_FLOW: "artifact" });
  const shellModel = spawnModel(MOCK_PORT + 4, { MOCK_FLOW: "shell" });
  const a2aRemote = spawn("node", ["scripts/mock-a2a.mjs"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_A2A_PORT: String(MOCK_PORT) },
    stdio: "inherit",
  });

  const server = spawn("pnpm", ["--filter", "@zagros/server", "start"], {
    cwd: ROOT,
    env: {
      ...process.env,
      ZAGROS_DATA: join(WORKDIR, "data"),
      ZAGROS_HOST: "127.0.0.1",
      ZAGROS_PORT: String(PORT),
      ZAGROS_MASTER_KEY: "v08-verify-master-key",
      ZAGROS_RUNNER_TOKEN: "v08-runner-token",
      ZAGROS_PUBLIC_URL: `http://127.0.0.1:${PORT}`,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  server.stdout.on("data", (d) => appendFileSync(SERVER_LOG, d));

  try {
    await waitFor(async () => (await req("GET", "/api/health")).data?.ok, 30000, 500, "server health");
    await sleep(1500);

    console.log("--- agents ---");
    const subagent = await req("POST", "/api/agents", {
      name: "Sub Agent",
      systemPrompt: "You are the specialist sub-agent.",
      model: {
        driver: "openai-compatible",
        model: "memory",
        baseUrl: modelBaseUrl(MOCK_PORT + 1),
        temperature: 0.2,
        imageInput: true,
      },
      group: "specialists",
    });
    check("subagent created with group", subagent.data.group === "specialists");

    const delegateModel = spawnModel(MOCK_PORT + 5, {
      MOCK_FLOW: "delegate",
      MOCK_DELEGATE_AGENT: subagent.data.id,
    });
    await waitFor(async () => {
      return await fetch(`http://127.0.0.1:${MOCK_PORT + 5}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "ping" }], stream: false }),
      }).then((r) => r.ok).catch(() => false);
    }, 15000, 300, "delegate model ready");

    const coordinator = await req("POST", "/api/agents", {
      name: "Coordinator",
      systemPrompt: "You are the coordinator agent. Delegate work to specialists.",
      model: {
        driver: "openai-compatible",
        model: "delegate",
        baseUrl: modelBaseUrl(MOCK_PORT + 5),
        temperature: 0.2,
        imageInput: true,
      },
    });

    console.log("--- internal delegation ---");
    const conv = await req("POST", "/api/conversations", { agentId: coordinator.data.id, title: "V08 Chat" });
    const sent = await req("POST", `/api/conversations/${conv.data.id}/messages`, {
      content: "Verify the numbers using the specialist.",
    });
    const task = await waitTask(sent.data.task.id);
    check("coordinator task completes", task.status === "completed", task.status);
    const coordinatorConv = await req("GET", `/api/conversations/${conv.data.id}`);
    const coordinatorReply = coordinatorConv.data.messages.filter((m) => m.role === "assistant").at(-1)?.content ?? "";
    check("coordinator received subtask result", coordinatorReply.includes("coordinator-saw:") && coordinatorReply.includes("subtask-ok"), coordinatorReply.slice(0, 100));
    const subConversations = await req("GET", "/api/conversations");
    const subConv = subConversations.data.find((c) => c.title?.startsWith("Delegated:"));
    check("subtask conversation created", Boolean(subConv), JSON.stringify(subConversations.data.map((c) => c.title)));
    const delegateSteps = task.steps.filter((s) => s.toolId === "agent.delegate");
    check("delegate step recorded", delegateSteps.length === 1 && delegateSteps[0]?.status === "completed");

    console.log("--- parallel delegation ---");
    const parallelModel = spawnModel(MOCK_PORT + 6, {
      MOCK_FLOW: "delegate",
      MOCK_DELEGATE_AGENT: subagent.data.id,
      MOCK_DELEGATE_PARALLEL: "2",
    });
    await waitFor(async () => {
      return await fetch(`http://127.0.0.1:${MOCK_PORT + 6}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "ping" }], stream: false }),
      }).then((r) => r.ok).catch(() => false);
    }, 15000, 300, "parallel model ready");
    const parallelCoordinator = await req("POST", "/api/agents", {
      name: "Parallel Coordinator",
      systemPrompt: "You are the parallel coordinator.",
      model: {
        driver: "openai-compatible",
        model: "parallel",
        baseUrl: modelBaseUrl(MOCK_PORT + 6),
        temperature: 0.2,
        imageInput: true,
      },
    });
    const parallelConv = await req("POST", "/api/conversations", { agentId: parallelCoordinator.data.id, title: "V08 Parallel" });
    const sentP = await req("POST", `/api/conversations/${parallelConv.data.id}/messages`, { content: "Verify both numbers in parallel." });
    const taskP = await waitTask(sentP.data.task.id);
    const parallelSteps = taskP.steps.filter((s) => s.toolId === "agent.delegate");
    check("two delegate steps in one turn", parallelSteps.length === 2, `steps: ${parallelSteps.length}`);
    check("both subtasks completed", parallelSteps.every((s) => s.status === "completed"));
    const parallelChat = await req("GET", `/api/conversations/${parallelConv.data.id}`);
    const parallelReply = parallelChat.data.messages.filter((m) => m.role === "assistant").at(-1)?.content ?? "";
    check("coordinator summarizes both results", (parallelReply.match(/subtask-ok/g) ?? []).length >= 2, parallelReply.slice(0, 120));

    console.log("--- per-agent permissions ---");
    const deniedAgent = await req("POST", "/api/agents", {
      name: "Restricted Agent",
      systemPrompt: "You are restricted.",
      permissions: { denyTools: ["shell.exec"], approvalTools: [] },
      model: {
        driver: "openai-compatible",
        model: "shell",
        baseUrl: modelBaseUrl(MOCK_PORT + 4),
        temperature: 0.2,
        imageInput: true,
      },
    });
    const deniedConv = await req("POST", "/api/conversations", { agentId: deniedAgent.data.id });
    const sentD = await req("POST", `/api/conversations/${deniedConv.data.id}/messages`, { content: "Run the shell command." });
    const taskD = await waitTask(sentD.data.task.id);
    const deniedStep = taskD.steps.find((s) => s.toolId === "shell.exec");
    check(
      "denied tool blocked by agent permissions",
      deniedStep?.status === "failed" && (deniedStep?.error ?? "").includes("denied for this agent"),
      deniedStep?.error?.slice(0, 90)
    );

    console.log("--- shared artifacts ---");
    const artifactAgent = await req("POST", "/api/agents", {
      name: "Artifact Agent",
      systemPrompt: "You are the artifact agent.",
      model: {
        driver: "openai-compatible",
        model: "artifact",
        baseUrl: modelBaseUrl(MOCK_PORT + 3),
        temperature: 0.2,
        imageInput: true,
      },
    });
    const artifactConv = await req("POST", "/api/conversations", { agentId: artifactAgent.data.id });
    const sentA = await req("POST", `/api/conversations/${artifactConv.data.id}/messages`, { content: "Store and retrieve the build id." });
    const taskA = await waitTask(sentA.data.task.id);
    check("artifact flow completes", taskA.status === "completed");
    const artifactConvData = await req("GET", `/api/conversations/${artifactConv.data.id}`);
    const artifactReply = artifactConvData.data.messages.filter((m) => m.role === "assistant").at(-1)?.content ?? "";
    check("artifact round-trip (save then get)", artifactReply.includes("artifact-flow:abc123"), artifactReply.slice(0, 80));
    const artifacts = await req("GET", "/api/artifacts");
    check("artifacts listed via API", artifacts.data.some((a) => a.key === "build-id" && a.value === "abc123"));

    console.log("--- A2A client (external agent via approval) ---");
    const a2aAgent = await req("POST", "/api/agents", {
      name: "A2A Coordinator",
      systemPrompt: "You call external agents.",
      model: {
        driver: "openai-compatible",
        model: "a2a",
        baseUrl: modelBaseUrl(MOCK_PORT + 2),
        temperature: 0.2,
        imageInput: true,
      },
    });
    const a2aConv = await req("POST", "/api/conversations", { agentId: a2aAgent.data.id });
    const sentA2a = await req("POST", `/api/conversations/${a2aConv.data.id}/messages`, {
      content: "Ask the remote agent to ping.",
    });
    const a2aTask = await waitFor(async () => {
      const t = await req("GET", `/api/tasks/${sentA2a.data.task.id}`);
      return t.data.status === "waiting_for_approval" ? t.data : null;
    }, 30000, 500, "a2a approval");
    check("a2a.call requires approval (R2)", true);
    const approval = await req("GET", `/api/approvals?taskId=${a2aTask.id}`);
    const pending = approval.data.find((a) => a.status === "pending" && a.toolId === "a2a.call");
    check("approval record for a2a.call", Boolean(pending), JSON.stringify(approval.data.map((a) => a.toolId)));
    await req("POST", `/api/approvals/${pending.id}/decide`, { decision: "approved" });
    const a2aTaskFinal = await waitTask(a2aTask.id);
    const a2aConvData = await req("GET", `/api/conversations/${a2aConv.data.id}`);
    const a2aReply = a2aConvData.data.messages.filter((m) => m.role === "assistant").at(-1)?.content ?? "";
    check(
      "external agent reply returned to coordinator",
      a2aTaskFinal.status === "completed" && a2aReply.includes("a2a-result:remote-a2a-reply"),
      a2aReply.slice(0, 100)
    );

    console.log("--- A2A server (agent exposed to external agents) ---");
    const a2aAgents = await req("GET", "/api/a2a/agents");
    const subEntry = a2aAgents.data.find((a) => a.agentId === subagent.data.id);
    check("agent exposed with card URL", Boolean(subEntry?.cardUrl), JSON.stringify(subEntry));
    const card = await fetch(`http://127.0.0.1:${PORT}${subEntry.cardUrl.replace(`http://127.0.0.1:${PORT}`, "")}`);
    const cardJson = await card.json();
    check("Agent Card served", card.ok && cardJson.name === "Sub Agent" && cardJson.protocolVersion === "1.0");

    const jsonrpc = await fetch(`http://127.0.0.1:${PORT}/a2a/${subagent.data.id}/jsonrpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "ext-1",
        method: "message/send",
        params: { sessionId: "ext-session", message: { role: "user", parts: [{ kind: "text", text: "hello from an external agent" }] } },
      }),
    });
    const jsonrpcJson = await jsonrpc.json();
    const a2aText = (jsonrpcJson?.result?.parts ?? []).map((p) => p.text ?? "").join("");
    check("external message/send runs the agent and replies", jsonrpc.ok && a2aText.includes("subtask-ok"), a2aText.slice(0, 80));

    console.log("\n=== v0.8.0 CHECKLIST ===");
    const criteria = [
      ["agent delegation (subtasks)", PASS.includes("coordinator received subtask result") && PASS.includes("subtask conversation created")],
      ["parallel steps", PASS.includes("two delegate steps in one turn") && PASS.includes("coordinator summarizes both results")],
      ["agent groups", PASS.includes("subagent created with group")],
      ["shared artifacts", PASS.includes("artifact round-trip (save then get)")],
      ["per-agent permissions", PASS.includes("denied tool blocked by agent permissions")],
      ["A2A client (external agent)", PASS.includes("external agent reply returned to coordinator")],
      ["A2A server + Agent Cards", PASS.includes("Agent Card served") && PASS.includes("external message/send runs the agent and replies")],
    ];
    for (const [name, ok] of criteria) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  } finally {
    server.kill("SIGTERM");
    memoryModel.kill("SIGTERM");
    a2aModel.kill("SIGTERM");
    artifactModel.kill("SIGTERM");
    shellModel.kill("SIGTERM");
    a2aRemote.kill("SIGTERM");
    spawnSync("pkill", ["-f", "zagros/server"], { stdio: "ignore" });
    spawnSync("pkill", ["-f", "mock-model"], { stdio: "ignore" });
    spawnSync("pkill", ["-f", "mock-a2a"], { stdio: "ignore" });
  }

  console.log(`\n${PASS.length} checks passed, ${FAIL.length} failed`);
  process.exit(FAIL.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
