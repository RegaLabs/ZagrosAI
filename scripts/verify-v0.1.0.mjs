import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SERVER_PORT = 8787;
const MOCK_PORT = 10000 + (Date.now() % 20000);
const RUNNER_TOKEN = "verify-token-abc123";
const WORKDIR = join(tmpdir(), `zagros-verify-${Date.now()}`);
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

async function waitFor(fn, timeoutMs, intervalMs = 250, label = "condition") {
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
  const res = await fetch(`http://127.0.0.1:${SERVER_PORT}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

async function postJson(path, body) {
  const res = await fetch(`http://127.0.0.1:${SERVER_PORT}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function putJson(path, body) {
  const res = await fetch(`http://127.0.0.1:${SERVER_PORT}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PUT ${path} -> ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function main() {
  spawnSync("bash", ["-c", 'PIDS=$(ss -tlnp 2>/dev/null | grep ":8787 " | grep -oP "pid=\\K[0-9]+" | sort -u); for p in $PIDS; do kill -9 $p 2>/dev/null; done'], { stdio: "ignore" });  // kill-port-8787

  spawnSync("pkill", ["-f", "dist/index.js"], { stdio: "ignore" });
  spawnSync("pkill", ["-f", "mock-model"], { stdio: "ignore" });
  spawnSync("pkill", ["-f", "mock-oauth-mcp"], { stdio: "ignore" });
  await sleep(500);

  mkdirSync(WORKDIR, { recursive: true });
  console.log(`verify workspace: ${WORKDIR}`);

  const mock = spawn("node", ["scripts/mock-model.mjs"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_MODEL_PORT: String(MOCK_PORT) },
    stdio: "inherit",
  });

  const server = spawn("pnpm", ["--filter", "@zagros/server", "start"], {
    cwd: ROOT,
    env: {
      ...process.env,
      ZAGROS_DATA: join(WORKDIR, "data"),
      ZAGROS_HOST: "127.0.0.1",
      ZAGROS_PORT: String(SERVER_PORT),
      ZAGROS_RUNNER_TOKEN: RUNNER_TOKEN,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  server.stdout.on("data", (d) => appendFileSync(SERVER_LOG, d));

  const runner = spawn("node", [
    join(ROOT, "apps/runner/dist/index.js"),
    "start",
    "--url",
    `ws://127.0.0.1:${SERVER_PORT}/ws/runner`,
    "--name",
    "verify-laptop",
    "--token",
    RUNNER_TOKEN,
    "--workspace",
    join(WORKDIR, "runner-workspace"),
  ], {
    cwd: ROOT,
    stdio: "inherit",
  });

  try {
    console.log("waiting for server health...");
    await waitFor(async () => (await getJson("/api/health")).ok, 30000, 500, "server health");

    const toolBodies = await getJson("/api/tools");
    const shellTool = toolBodies.find((t) => t.id === "shell.exec");
    check("tool registry exposes shell.exec", Boolean(shellTool), `found: ${toolBodies.map((t) => t.id).join(", ")}`);
    check("shell.exec routes to runner (provider)", shellTool?.provider === "runner", shellTool?.provider);

    await waitFor(
      async () => (await getJson("/api/workers")).some((w) => w.online),
      15000,
      500,
      "runner online"
    );
    check("runner connects and reports online", true);

    await putJson("/api/settings", {
      defaultModel: {
        driver: "openai-compatible",
        model: "mock-model",
        baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
        temperature: 0.2,
        imageInput: true,
      },
    });

    const agent = await postJson("/api/agents", {
      name: "Verify Agent",
      systemPrompt: "You are a verification agent.",
    });
    check("create agent", Boolean(agent.id), agent.id);

    const conversation = await postJson("/api/conversations", { agentId: agent.id, title: "Verify Chat" });
    check("create conversation", Boolean(conversation.id), conversation.id);

    const pngPath = join(ROOT, "apps/web/public/icons/icon-192.png");
    const pngBuffer = readFileSync(pngPath);
    const form = new FormData();
    form.append("file", new Blob([pngBuffer], { type: "image/png" }), "test-attachment.png");
    const uploadRes = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/uploads`, {
      method: "POST",
      body: form,
    });
    const upload = await uploadRes.json();
    check("upload image attachment", uploadRes.ok && upload.kind === "image", JSON.stringify(upload));

    const sent = await postJson(`/api/conversations/${conversation.id}/messages`, {
      content: "Run the shell command to verify the execution fabric, then tell me what it printed.",
      attachments: [{ attachmentId: upload.attachmentId }],
    });
    check("send task message", Boolean(sent.task), sent.task.id);
    const taskId = sent.task.id;

    const finalTask = await waitFor(async () => {
      const t = await getJson(`/api/tasks/${taskId}`);
      return t.status === "completed" || t.status === "failed" ? t : null;
    }, 60000, 500, "task terminal state");
    console.log(`task status: ${finalTask.status}${finalTask.error ? ` error: ${finalTask.error}` : ""}`);

    check("task completes", finalTask.status === "completed", finalTask.status);
    const shellStep = finalTask.steps.find((s) => s.toolId === "shell.exec");
    check("agent calls tool (shell.exec step)", Boolean(shellStep), JSON.stringify(finalTask.steps.map((s) => s.toolId)));
    check("agent executes local command on runner", shellStep?.status === "completed", shellStep?.status);
    check(
      "tool result contains command output",
      typeof shellStep?.result?.stdout === "string" && shellStep.result.stdout.includes("hello-from-zagros"),
      JSON.stringify(shellStep?.result)?.slice(0, 200)
    );
    check("tool ran on the runner worker", Boolean(shellStep?.workerId), shellStep?.workerId);

    const convDetail = await getJson(`/api/conversations/${conversation.id}`);
    const roles = convDetail.messages.map((m) => m.role);
    check("conversation has user/tool/assistant messages", roles.includes("user") && roles.includes("tool") && roles.includes("assistant"), roles.join(","));
    const userMsg = convDetail.messages.find((m) => m.role === "user");
    check("user message references the image attachment", userMsg?.attachments?.length === 1 && userMsg.attachments[0].id === upload.attachmentId);
    const finalText = convDetail.messages.filter((m) => m.role === "assistant").at(-1)?.content ?? "";
    check("assistant summary mentions output", finalText.includes("hello-from-zagros"), finalText.slice(0, 160));

    const audit = await getJson("/api/audit?limit=200");
    check("audit log records tool events", audit.some((a) => a.type === "tool.started" && a.toolId === "shell.exec") && audit.some((a) => a.type === "tool.completed"));
    check("audit log records task completion", audit.some((a) => a.type === "task.completed"));

    console.log("simulating browser refresh: restarting server (same data dir)...");
    server.kill("SIGTERM");
    await sleep(1500);
    const server2 = spawn("pnpm", ["--filter", "@zagros/server", "start"], {
      cwd: ROOT,
      env: {
        ...process.env,
        ZAGROS_DATA: join(WORKDIR, "data"),
        ZAGROS_HOST: "127.0.0.1",
        ZAGROS_PORT: String(SERVER_PORT),
        ZAGROS_RUNNER_TOKEN: RUNNER_TOKEN,
      },
      stdio: ["ignore", "pipe", "inherit"],
    });
    server2.stdout.on("data", (d) => appendFileSync(SERVER_LOG, d));

    await waitFor(async () => (await getJson("/api/health")).ok, 30000, 500, "server restarted");
    const tasksAfterRestart = await getJson("/api/tasks");
    const persisted = tasksAfterRestart.find((t) => t.id === taskId);
    check("task survives server restart (browser refresh)", Boolean(persisted) && persisted.status === "completed", persisted?.status);
    const convAfterRestart = await getJson(`/api/conversations/${conversation.id}`);
    check("messages survive restart", convAfterRestart.messages.length === convDetail.messages.length, `${convAfterRestart.messages.length} vs ${convDetail.messages.length}`);
    const imgRes = await fetch(`http://127.0.0.1:${SERVER_PORT}${upload.url}`);
    check("uploaded image is served", imgRes.ok && (imgRes.headers.get("content-type") ?? "").includes("image"));
    server2.kill("SIGTERM");

    console.log("\n=== v0.1.0 EXIT CRITERIA ===");
    const criteria = [
      ["create agent", PASS.includes("create agent")],
      ["attach image", PASS.includes("upload image attachment") && PASS.includes("user message references the image attachment")],
      ["ask task", PASS.includes("send task message")],
      ["agent calls tool", PASS.includes("agent calls tool (shell.exec step)")],
      ["agent executes local command", PASS.includes("agent executes local command on runner")],
      ["task survives browser refresh", PASS.includes("task survives server restart (browser refresh)")],
    ];
    for (const [name, ok] of criteria) {
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
    }
  } finally {
    runner.kill("SIGTERM");
    server.kill("SIGTERM");
    mock.kill("SIGTERM");
    spawnSync("pkill", ["-f", "zagros/server"], { stdio: "ignore" });
    spawnSync("pkill", ["-f", "mock-model.mjs"], { stdio: "ignore" });
  }

  console.log(`\n${PASS.length} checks passed, ${FAIL.length} failed`);
  process.exit(FAIL.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
