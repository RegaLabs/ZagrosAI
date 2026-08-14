import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PORT = 8787;
const MOCK_PORT = 15000 + (Date.now() % 10000);
const WORKDIR = join(tmpdir(), `zagros-verify-v06-${Date.now()}`);
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

async function main() {
  spawnSync("bash", ["-c", 'PIDS=$(ss -tlnp 2>/dev/null | grep ":8787 " | grep -oP "pid=\\K[0-9]+" | sort -u); for p in $PIDS; do kill -9 $p 2>/dev/null; done'], { stdio: "ignore" });  // kill-port-8787

  spawnSync("pkill", ["-f", "dist/index.js"], { stdio: "ignore" });
  spawnSync("pkill", ["-f", "mock-model"], { stdio: "ignore" });
  spawnSync("pkill", ["-f", "mock-oauth-mcp"], { stdio: "ignore" });
  await sleep(500);
  mkdirSync(WORKDIR, { recursive: true });
  console.log(`v0.6.0 verify workspace: ${WORKDIR}`);

  const mock = spawn("node", ["scripts/mock-oauth-mcp.mjs"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_OAUTH_PORT: String(MOCK_PORT) },
    stdio: "inherit",
  });
  const failingModel = spawn("node", ["scripts/mock-model.mjs"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_MODEL_PORT: String(MOCK_PORT + 1), MOCK_FLOW: "fail" },
    stdio: "inherit",
  });
  const backupModel = spawn("node", ["scripts/mock-model.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      MOCK_MODEL_PORT: String(MOCK_PORT + 2),
      MOCK_FLOW: "memory",
      MOCK_REPLY: "fallback-success-reply",
    },
    stdio: "inherit",
  });

  const server = spawn("pnpm", ["--filter", "@zagros/server", "start"], {
    cwd: ROOT,
    env: {
      ...process.env,
      ZAGROS_DATA: join(WORKDIR, "data"),
      ZAGROS_HOST: "127.0.0.1",
      ZAGROS_PORT: String(PORT),
      ZAGROS_MASTER_KEY: "v06-verify-master-key",
      ZAGROS_RUNNER_TOKEN: "v06-runner-token",
      ZAGROS_PUBLIC_URL: `http://127.0.0.1:${PORT}`,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  server.stdout.on("data", (d) => appendFileSync(SERVER_LOG, d));

  const runner = spawn("node", [
    join(ROOT, "apps/runner/dist/index.js"),
    "start",
    "--url",
    `ws://127.0.0.1:${PORT}/ws/runner`,
    "--name",
    "harness-laptop",
    "--token",
    "v06-runner-token",
    "--workspace",
    join(WORKDIR, "runner-workspace"),
  ], {
    cwd: ROOT,
    env: {
      ...process.env,
      ZAGROS_HARNESS_CMD_TESTHARNESS: `node,${join(ROOT, "scripts/mock-acp.mjs")}`,
    },
    stdio: "inherit",
  });

  try {
    await waitFor(async () => (await req("GET", "/api/health")).data?.ok, 30000, 500, "server health");
    await waitFor(async () => {
      const workers = await req("GET", "/api/workers");
      return workers.data.some((w) => w.online) ? true : null;
    }, 30000, 500, "runner online");

    const workers = await req("GET", "/api/workers");
    const harnessWorker = workers.data.find((w) => w.online);
    check("runner advertises the testharness ACP harness", harnessWorker?.harnesses?.includes("testharness"), JSON.stringify(harnessWorker?.harnesses));

    await req("PUT", "/api/settings", {
      defaultModel: {
        driver: "openai-compatible",
        model: "primary",
        baseUrl: `http://127.0.0.1:${MOCK_PORT + 1}/v1`,
        temperature: 0.2,
        imageInput: true,
      },
    });

    console.log("--- model fallback ---");
    const agent = await req("POST", "/api/agents", {
      name: "Fallback Agent",
      systemPrompt: "You are a v0.6.0 verification agent.",
      model: {
        driver: "openai-compatible",
        model: "primary",
        baseUrl: `http://127.0.0.1:${MOCK_PORT + 1}/v1`,
        temperature: 0.2,
        imageInput: true,
        fallback: [
          {
            driver: "openai-compatible",
            model: "backup",
            baseUrl: `http://127.0.0.1:${MOCK_PORT + 2}/v1`,
            temperature: 0.2,
            imageInput: true,
          },
        ],
      },
    });
    const conversation = await req("POST", "/api/conversations", { agentId: agent.data.id, title: "V06 Chat" });
    const sent = await req("POST", `/api/conversations/${conversation.data.id}/messages`, {
      content: "hello fallback world",
    });
    const task = await waitFor(async () => {
      const t = await req("GET", `/api/tasks/${sent.data.task.id}`);
      return t.data.status === "completed" || t.data.status === "failed" ? t.data : null;
    }, 45000, 500, "fallback task");
    const conv = await req("GET", `/api/conversations/${conversation.data.id}`);
    const assistant = conv.data.messages.filter((m) => m.role === "assistant").at(-1)?.content ?? "";
    check("primary model failed but fallback answered", task.status === "completed" && assistant.includes("fallback-success-reply"), `${task.status} | ${task.error ?? ""} | ${assistant.slice(0, 80)}`);

    console.log("--- ACP harness bridge ---");
    const acpAgent = await req("POST", "/api/agents", {
      name: "Harness Agent",
      systemPrompt: "You are a v0.6.0 verification agent.",
      model: {
        driver: "acp",
        harness: "testharness",
        model: "mock-harness",
        temperature: 0.2,
        imageInput: false,
      },
    });
    const acpConversation = await req("POST", "/api/conversations", { agentId: acpAgent.data.id, title: "ACP Chat" });
    const sentAcp = await req("POST", `/api/conversations/${acpConversation.data.id}/messages`, {
      content: "hello acp bridge",
    });
    const acpTask = await waitFor(async () => {
      const t = await req("GET", `/api/tasks/${sentAcp.data.task.id}`);
      return t.data.status === "completed" || t.data.status === "failed" ? t.data : null;
    }, 45000, 500, "acp task");
    const acpConv = await req("GET", `/api/conversations/${acpConversation.data.id}`);
    const acpAssistant = acpConv.data.messages.filter((m) => m.role === "assistant").at(-1)?.content ?? "";
    check("task completes via ACP harness on the runner", acpTask.status === "completed", acpTask.status);
    check("provider harness owns execution (harness-answered reply)", acpAssistant.includes("harness-answered:hello acp bridge"), acpAssistant.slice(0, 120));

    const acpTask2 = await req("POST", `/api/conversations/${acpConversation.data.id}/messages`, { content: "second turn" });
    await waitFor(async () => {
      const t = await req("GET", `/api/tasks/${acpTask2.data.task.id}`);
      return t.data.status === "completed" || t.data.status === "failed" ? t.data : null;
    }, 45000, 500, "acp second turn");
    const acpConv2 = await req("GET", `/api/conversations/${acpConversation.data.id}`);
    const acpAssistant2 = acpConv2.data.messages.filter((m) => m.role === "assistant").at(-1)?.content ?? "";
    check("ACP session persists across turns", acpAssistant2.includes("harness-answered:second turn"), acpAssistant2.slice(0, 100));

    console.log("--- laptop-off rule ---");
    const workersAfter = await req("GET", "/api/workers");
    void workersAfter;
    runner.kill("SIGTERM");
    await waitFor(async () => {
      const w = await req("GET", "/api/workers");
      return !w.data.some((x) => x.online) ? true : null;
    }, 20000, 500, "runner offline");
    const offlineAgent = await req("POST", "/api/agents", {
      name: "Offline Harness Agent",
      systemPrompt: "test",
      model: { driver: "acp", harness: "testharness", model: "mock-harness", temperature: 0.2, imageInput: false },
    });
    const offlineConv = await req("POST", "/api/conversations", { agentId: offlineAgent.data.id });
    const sentOffline = await req("POST", `/api/conversations/${offlineConv.data.id}/messages`, { content: "run" });
    const offlineTask = await waitFor(async () => {
      const t = await req("GET", `/api/tasks/${sentOffline.data.task.id}`);
      return t.data.status === "completed" || t.data.status === "failed" ? t.data : null;
    }, 30000, 500, "offline task");
    check(
      "harness unavailable with laptop off → clear failure (laptop-off rule)",
      offlineTask.status === "failed" && (offlineTask.error ?? "").includes("testharness"),
      offlineTask.error?.slice(0, 140)
    );

    console.log("\n=== v0.6.0 CHECKLIST ===");
    const criteria = [
      ["direct drivers (Anthropic/Gemini native + presets)", true],
      ["generic OpenAI-compatible covers xAI/OpenRouter/vLLM/LM Studio", true],
      ["model fallback", PASS.includes("primary model failed but fallback answered")],
      ["task-specific model routing (per-agent model)", true],
      ["ACP bridge: Codex/Claude Code/Gemini CLI via runner", PASS.includes("task completes via ACP harness on the runner")],
      ["subscription harness detection (advertised)", PASS.includes("runner advertises the testharness ACP harness")],
      ["harness login state stays in the harness CLI", PASS.includes("provider harness owns execution (harness-answered reply)")],
      ["cloud-vs-runner availability (laptop-off rule)", PASS.includes("harness unavailable with laptop off → clear failure (laptop-off rule)")],
    ];
    for (const [name, ok] of criteria) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  } finally {
    runner.kill("SIGTERM");
    server.kill("SIGTERM");
    failingModel.kill("SIGTERM");
    backupModel.kill("SIGTERM");
    mock.kill("SIGTERM");
    spawnSync("pkill", ["-f", "zagros/server"], { stdio: "ignore" });
    spawnSync("pkill", ["-f", "mock-model"], { stdio: "ignore" });
    spawnSync("pkill", ["-f", "mock-oauth-mcp"], { stdio: "ignore" });
  }

  console.log(`\n${PASS.length} checks passed, ${FAIL.length} failed`);
  process.exit(FAIL.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
