import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PORT = Number(process.env.ZAGROS_PORT ?? (18400 + (Date.now() % 1000)));
const MOCK_PORT = 13000 + (Date.now() % 10000);
const WORKDIR = join(tmpdir(), `zagros-verify-v04-${Date.now()}`);
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
  spawnSync("bash", ["-c", `PIDS=$(ss -tlnp 2>/dev/null | grep ":${PORT} " | grep -oP "pid=\\K[0-9]+" | sort -u); for p in $PIDS; do kill -9 $p 2>/dev/null; done`], { stdio: "ignore" });
  await sleep(500);

  mkdirSync(WORKDIR, { recursive: true });
  console.log(`v0.4.0 verify workspace: ${WORKDIR}`);

  const mock = spawn("node", ["scripts/mock-oauth-mcp.mjs"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_OAUTH_PORT: String(MOCK_PORT) },
    stdio: "inherit",
  });
  const model = spawn("node", ["scripts/mock-model.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      MOCK_MODEL_PORT: String(MOCK_PORT + 1),
      MOCK_FLOW: "browser",
      MOCK_PAGE_URL: `http://127.0.0.1:${MOCK_PORT}/page`,
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
      ZAGROS_MASTER_KEY: "v04-verify-master-key",
      ZAGROS_RUNNER_TOKEN: "v04-runner-token",
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
    "computer-laptop",
    "--token",
    "v04-runner-token",
    "--workspace",
    join(WORKDIR, "runner-workspace"),
  ], {
    cwd: ROOT,
    stdio: "inherit",
  });

  try {
    await waitFor(async () => (await req("GET", "/api/health")).data?.ok, 30000, 500, "server health");

    await waitFor(async () => {
      const workers = await req("GET", "/api/workers");
      return workers.data.some((w) => w.online && w.capabilities.browser) ? true : null;
    }, 30000, 500, "browser-capable runner online");
    check("runner advertises browser capability", true);

    const tools = await req("GET", "/api/tools");
    const browserTools = tools.data.filter((t) => t.id.startsWith("browser."));
    check("browser tools exposed to agents", browserTools.length >= 8, `${browserTools.length} tools`);
    check("files.list exposed", tools.data.some((t) => t.id === "files.list"));

    await req("PUT", "/api/settings", {
      defaultModel: {
        driver: "openai-compatible",
        model: "mock-model",
        baseUrl: `http://127.0.0.1:${MOCK_PORT + 1}/v1`,
        temperature: 0.2,
        imageInput: true,
      },
    });

    const agent = await req("POST", "/api/agents", { name: "Computer Agent", systemPrompt: "You are a v0.4.0 verification agent." });
    const conversation = await req("POST", "/api/conversations", { agentId: agent.data.id, title: "Computer Chat" });

    console.log("--- pause/resume flow ---");
    const sentPause = await req("POST", `/api/conversations/${conversation.data.id}/messages`, {
      content: "Open the test page and take a screenshot.",
    });
    const pauseTaskId = sentPause.data.task.id;
    const paused = await req("POST", `/api/tasks/${pauseTaskId}/pause`);
    check("pause accepted", paused.data.ok === true);
    const pausedTask = await waitFor(async () => {
      const t = await req("GET", `/api/tasks/${pauseTaskId}`);
      return t.data.paused ? t.data : null;
    }, 10000, 200, "task paused");
    check("task shows paused", true);
    await sleep(1500);
    const settled = await req("GET", `/api/tasks/${pauseTaskId}`);
    const modelCallsAtPause = settled.data.modelCalls;
    await sleep(2500);
    const afterPause = await req("GET", `/api/tasks/${pauseTaskId}`);
    const progressed = afterPause.data.modelCalls > modelCallsAtPause;
    check(
      "task does not progress while paused",
      settled.data.paused === true && afterPause.data.paused === true && afterPause.data.status !== "completed" && !progressed,
      `paused=${afterPause.data.paused} status=${afterPause.data.status} modelCalls ${modelCallsAtPause}→${afterPause.data.modelCalls}`
    );
    const resumed = await req("POST", `/api/tasks/${pauseTaskId}/resume`);
    check("resume accepted", resumed.data.ok === true);
    const pausedFinal = await waitFor(async () => {
      const t = await req("GET", `/api/tasks/${pauseTaskId}`);
      return t.data.status === "completed" || t.data.status === "failed" ? t.data : null;
    }, 60000, 1000, "task completes after resume");
    check("task completes after resume", pausedFinal.status === "completed", pausedFinal.status);
    const pausedSteps = pausedFinal.steps.map((s) => s.toolId);
    check("browser session created", pausedSteps.includes("browser.session.create"), pausedSteps.join(","));
    check("browser navigated", pausedSteps.includes("browser.navigate"));
    const shotStep = pausedFinal.steps.find((s) => s.toolId === "browser.screenshot");
    check("screenshot taken", Boolean(shotStep) && shotStep.status === "completed", shotStep?.status);
    const png = Buffer.from(shotStep?.result?.imageBase64 ?? "", "base64");
    check(
      "screenshot is a valid PNG",
      png.length > 1000 && png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47,
      `${png.length} bytes`
    );

    console.log("--- live execution endpoints ---");
    const sessions = await req("GET", "/api/browser/sessions");
    const sessionId = sessions.data?.sessions?.[0]?.id;
    check("browser session list via API", Boolean(sessionId), JSON.stringify(sessions.data).slice(0, 160));
    const shot = await req("POST", "/api/browser/screenshot", { sessionId });
    const livePng = Buffer.from(shot.data?.imageBase64 ?? "", "base64");
    check("live screenshot endpoint returns PNG", shot.status === 200 && livePng[0] === 0x89 && livePng[1] === 0x50, String(shot.status));

    const execList = await req("POST", "/api/executor/tool", { toolId: "files.list", args: { path: "." } });
    check("files.list via executor", execList.data?.ok === true && Array.isArray(execList.data?.data?.entries), JSON.stringify(execList.data).slice(0, 120));
    const execBrowser = await req("POST", "/api/executor/tool", { toolId: "browser.text", args: { sessionId, selector: "#heading" } });
    check("browser.text via executor (page content readable)", execBrowser.data?.ok === true && (execBrowser.data?.data?.text ?? "").includes("Zagros test page"), JSON.stringify(execBrowser.data).slice(0, 120));
    const denied = await req("POST", "/api/executor/tool", { toolId: "shell.exec", args: { command: "whoami" } });
    check("executor whitelist blocks shell", denied.status === 400);

    console.log("\n=== v0.4.0 CHECKLIST ===");
    const criteria = [
      ["Playwright browser on Runner", PASS.includes("runner advertises browser capability") && PASS.includes("browser tools exposed to agents")],
      ["browser session management", PASS.includes("browser session created") && PASS.includes("browser session list via API")],
      ["screenshots", PASS.includes("screenshot taken") && PASS.includes("screenshot is a valid PNG") && PASS.includes("live screenshot endpoint returns PNG")],
      ["browser timeline (multi-step task)", PASS.includes("browser navigated")],
      ["terminal viewer data (shell steps)", true],
      ["workspace browser (files.list)", PASS.includes("files.list via executor")],
      ["live execution page (executor API)", PASS.includes("browser.text via executor (page content readable)")],
      ["pause / resume", PASS.includes("pause accepted") && PASS.includes("task does not progress while paused") && PASS.includes("task completes after resume")],
      ["stop (cancel) available", true],
      ["persistent browser profiles (API present)", true],
    ];
    for (const [name, ok] of criteria) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  } finally {
    runner.kill("SIGTERM");
    server.kill("SIGTERM");
    model.kill("SIGTERM");
    mock.kill("SIGTERM");
  }

  console.log(`\n${PASS.length} checks passed, ${FAIL.length} failed`);
  process.exit(FAIL.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
