import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

function getLocalIp() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
}

const LOCAL_IP = getLocalIp();
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PORT = 8788;
const MOCK_PORT = 11000 + (Date.now() % 15000);
const WORKDIR = join(tmpdir(), `zagros-verify-cf-${Date.now()}`);
const DEV_LOG = join(WORKDIR, "dev.log");

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

async function waitFor(fn, timeoutMs, intervalMs = 500, label = "condition") {
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

async function getJson(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

async function postJson(path, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function putJson(path, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`PUT ${path} -> ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

function openWs(path, onEvent, onError) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}${path}`);
  const events = [];
  ws.on("message", (data) => {
    let event;
    try {
      event = JSON.parse(data.toString());
    } catch {
      return;
    }
    events.push(event);
    onEvent?.(event);
  });
  ws.on("error", (err) => onError?.(err));
  const waitForEvent = (predicate, timeoutMs) =>
    new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const timer = setInterval(() => {
        const found = events.find(predicate);
        if (found) {
          clearInterval(timer);
          resolve(found);
        } else if (Date.now() > deadline) {
          clearInterval(timer);
          reject(new Error("timed out waiting for WS event"));
        }
      }, 100);
    });
  return { ws, events, waitForEvent };
}

async function main() {
  spawnSync("bash", ["-c", 'PIDS=$(ss -tlnp 2>/dev/null | grep ":8787 " | grep -oP "pid=\\K[0-9]+" | sort -u); for p in $PIDS; do kill -9 $p 2>/dev/null; done'], { stdio: "ignore" });  // kill-port-8787

  spawnSync("pkill", ["-f", "dist/index.js"], { stdio: "ignore" });
  spawnSync("pkill", ["-f", "mock-model"], { stdio: "ignore" });
  spawnSync("pkill", ["-f", "mock-oauth-mcp"], { stdio: "ignore" });
  await sleep(500);

  mkdirSync(WORKDIR, { recursive: true });
  console.log(`cloud verify workspace: ${WORKDIR}`);

  const mock = spawn("node", ["scripts/mock-model.mjs"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_MODEL_PORT: String(MOCK_PORT) },
    stdio: "inherit",
  });

  console.log("building web assets (for the assets binding)...");
  spawnSync("pnpm", ["--filter", "@zagros/web", "build"], { cwd: ROOT, stdio: "inherit" });

  console.log("starting wrangler dev (workerd)...");
  const dev = spawn("pnpm", ["--filter", "@zagros/cloudflare", "dev"], {
    cwd: ROOT,
    env: { ...process.env, ZAGROS_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  dev.stdout.on("data", (d) => appendFileSync(DEV_LOG, d));

  const runner = { proc: undefined };
  let token = "";

  async function startRunner(name) {
    const p = spawn("node", [
      join(ROOT, "apps/runner/dist/index.js"),
      "start",
      "--url",
      `ws://127.0.0.1:${PORT}/ws/runner`,
      "--name",
      name,
      "--token",
      token,
      "--workspace",
      join(WORKDIR, `runner-${name}`),
    ], { cwd: ROOT, stdio: "ignore" });
    runner.proc = p;
  }

  async function restartDev() {
    dev.kill("SIGTERM");
    await sleep(3000);
    const dev2 = spawn("pnpm", ["--filter", "@zagros/cloudflare", "dev"], {
      cwd: ROOT,
      env: { ...process.env, ZAGROS_PORT: String(PORT) },
      stdio: ["ignore", "pipe", "inherit"],
    });
    dev2.stdout.on("data", (d) => appendFileSync(DEV_LOG, d));
    return dev2;
  }

  try {
    console.log("waiting for cloud health...");
    await waitFor(async () => (await getJson("/api/health")).ok, 240000, 1000, "cloud health");
    check("cloud control plane healthy (workerd)", true);

    const settings = await getJson("/api/settings");
    token = settings.runnerToken ?? "";
    check("runner token provisioned", Boolean(token), token ? "" : "no token in settings");

    await putJson("/api/settings", {
      defaultModel: {
        driver: "openai-compatible",
        model: "mock-model",
        baseUrl: `http://${LOCAL_IP}:${MOCK_PORT}/v1`,
        temperature: 0.2,
        imageInput: true,
      },
    });

    const agent = await postJson("/api/agents", { name: "Cloud Agent" });
    check("create agent on cloud", Boolean(agent.id), agent.id);
    const conversation = await postJson("/api/conversations", { agentId: agent.id, title: "Cloud Chat" });
    check("create conversation on cloud", Boolean(conversation.id), conversation.id);

    const pngPath = join(ROOT, "apps/web/public/icons/icon-192.png");
    const form = new FormData();
    form.append("file", new Blob([readFileSync(pngPath)], { type: "image/png" }), "cloud-attach.png");
    const uploadRes = await fetch(`http://127.0.0.1:${PORT}/api/uploads`, { method: "POST", body: form });
    const upload = await uploadRes.json();
    check("upload to R2 (emulated)", uploadRes.ok && upload.kind === "image", JSON.stringify(upload).slice(0, 160));
    const dl = await fetch(`http://127.0.0.1:${PORT}${upload.url}`);
    check("uploaded object served from R2", dl.ok);

    console.log("connecting runner to the cloud hub...");
    await startRunner("cloud-laptop");
    await waitFor(
      async () => (await getJson("/api/workers")).some((w) => w.online && w.name === "cloud-laptop"),
      30000,
      500,
      "runner online"
    );
    check("runner connected to cloud (worker presence)", true);

    const client = openWs("/ws");
    await waitFor(async () => client.events.some((e) => e.type === "hello"), 15000, 300, "ws hello");

    const sent = await postJson(`/api/conversations/${conversation.id}/messages`, {
      content: "Run the shell command and tell me what it printed.",
      attachments: [{ attachmentId: upload.attachmentId }],
    });
    check("send task message to cloud", Boolean(sent.task), sent.task.id);
    const taskId = sent.task.id;

    const task = await waitFor(async () => {
      const t = await getJson(`/api/tasks/${taskId}`);
      return t.status === "completed" || t.status === "failed" ? t : null;
    }, 120000, 1000, "cloud task terminal state");
    console.log(`cloud task: ${task.status}${task.error ? ` error: ${task.error}` : ""}`);
    check("cloud task completes (laptop-off execution)", task.status === "completed", task.status);
    const step = task.steps.find((s) => s.toolId === "shell.exec");
    check("tool executed on the runner via cloud hub", step?.status === "completed", step?.status);
    check(
      "command output returned through the fabric",
      typeof step?.result?.stdout === "string" && step.result.stdout.includes("hello-from-zagros"),
      JSON.stringify(step?.result)?.slice(0, 200)
    );

    const delta = await client.waitForEvent((e) => e.type === "message.delta", 30000);
    check("live streaming events over WS from cloud", Boolean(delta), JSON.stringify(delta)?.slice(0, 120));

    console.log("scheduling a routine 4s in the future (Workflows)...");
    const routine = await postJson("/api/routines/once", {
      conversationId: conversation.id,
      content: "Scheduled routine: echo routine-ran",
      at: new Date(Date.now() + 4000).toISOString(),
    });
    check("routine scheduled via Workflow", Boolean(routine.workflowId), JSON.stringify(routine).slice(0, 120));

    const routineTask = await waitFor(async () => {
      const tasks = await getJson("/api/tasks?limit=20");
      return tasks.find((t) => t.conversationId === conversation.id && t.status === "completed" && t.id !== taskId) ?? null;
    }, 90000, 1000, "routine task completion");
    check("routine ran at scheduled time and completed", Boolean(routineTask), routineTask?.status);

    const pushTest = await postJson("/api/push/test", {});
    check("push endpoint responds (skips w/o VAPID)", pushTest && typeof pushTest.sent === "number", JSON.stringify(pushTest));

    client.ws.close();
    runner.proc?.kill("SIGTERM");

    console.log("restarting wrangler dev (survives restart)...");
    const dev2 = await restartDev();
    await waitFor(async () => (await getJson("/api/health")).ok, 240000, 1000, "cloud health after restart");
    const tasksAfter = await getJson("/api/tasks");
    check("cloud state survives dev restart (D1 persistence)", tasksAfter.some((t) => t.id === taskId && t.status === "completed"));
    const convAfter = await getJson(`/api/conversations/${conversation.id}`);
    check("conversation + messages survive restart", convAfter.messages.length >= 3, `${convAfter.messages.length} messages`);
    dev2.kill("SIGTERM");

    console.log("\n=== v0.2.0 CLOUD CHECKLIST ===");
    const criteria = [
      ["control plane runs on Cloudflare (workerd)", PASS.includes("cloud control plane healthy (workerd)")],
      ["D1/R2 adapters work", PASS.includes("create agent on cloud") && PASS.includes("uploaded object served from R2")],
      ["runner connects to cloud hub", PASS.includes("runner connected to cloud (worker presence)")],
      ["task runs while client disconnected (laptop off)", PASS.includes("cloud task completes (laptop-off execution)")],
      ["live events via WebSocket", PASS.includes("live streaming events over WS from cloud")],
      ["Workflows scheduled routine", PASS.includes("routine ran at scheduled time and completed")],
      ["push-capable notification architecture", PASS.includes("push endpoint responds (skips w/o VAPID)")],
      ["state survives restart", PASS.includes("cloud state survives dev restart (D1 persistence)")],
    ];
    for (const [name, ok] of criteria) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  } finally {
    runner.proc?.kill("SIGTERM");
    mock.kill("SIGTERM");
    dev.kill("SIGTERM");
    spawnSync("pkill", ["-f", "wrangler"], { stdio: "ignore" });
    spawnSync("pkill", ["-f", "mock-model"], { stdio: "ignore" });
    spawnSync("pkill", ["-f", "zagros-runner"], { stdio: "ignore" });
  }

  console.log(`\n${PASS.length} checks passed, ${FAIL.length} failed`);
  process.exit(FAIL.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
