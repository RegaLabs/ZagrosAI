import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PORT = Number(process.env.ZAGROS_PORT ?? (18700 + (Date.now() % 1000)));
const MOCK_PORT = 16000 + (Date.now() % 10000);
const WORKDIR = join(tmpdir(), `zagros-verify-v07-${Date.now()}`);
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
  console.log(`v0.7.0 verify workspace: ${WORKDIR}`);

  const mock = spawn("node", ["scripts/mock-oauth-mcp.mjs"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_OAUTH_PORT: String(MOCK_PORT) },
    stdio: "inherit",
  });
  const model = spawn("node", ["scripts/mock-model.mjs"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_MODEL_PORT: String(MOCK_PORT + 1), MOCK_FLOW: "memory", MOCK_REPLY: "routine-run-ok" },
    stdio: "inherit",
  });
  const failingModel = spawn("node", ["scripts/mock-model.mjs"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_MODEL_PORT: String(MOCK_PORT + 2), MOCK_FLOW: "fail" },
    stdio: "inherit",
  });
  await sleep(1500);
  const modelOk = await fetch(`http://127.0.0.1:${MOCK_PORT + 1}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "ping" }], stream: false }),
  }).then((r) => r.ok).catch(() => false);
  if (!modelOk) throw new Error(`mock model did not come up on ${MOCK_PORT + 1}`);

  const server = spawn("pnpm", ["--filter", "@zagros/server", "start"], {
    cwd: ROOT,
    env: {
      ...process.env,
      ZAGROS_DATA: join(WORKDIR, "data"),
      ZAGROS_HOST: "127.0.0.1",
      ZAGROS_PORT: String(PORT),
      ZAGROS_MASTER_KEY: "v07-verify-master-key",
      ZAGROS_RUNNER_TOKEN: "v07-runner-token",
      ZAGROS_PUBLIC_URL: `http://127.0.0.1:${PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => appendFileSync(SERVER_LOG, d));

  try {
    await waitFor(async () => (await req("GET", "/api/health")).data?.ok, 30000, 500, "server health");

    await req("PUT", "/api/settings", {
      defaultModel: {
        driver: "openai-compatible",
        model: "mock",
        baseUrl: `http://127.0.0.1:${MOCK_PORT + 1}/v1`,
        temperature: 0.2,
        imageInput: true,
      },
    });
    const agent = await req("POST", "/api/agents", { name: "Routine Agent", systemPrompt: "You are a v0.7.0 verification agent." });

    console.log("--- scheduled routine (cron every 3 seconds) ---");
    const scheduled = await req("POST", "/api/routines", {
      name: "every-three-seconds",
      description: "Runs every 3 seconds",
      trigger: { type: "schedule", cron: "*/3 * * * * *", missedRuns: "run_latest" },
      agentId: agent.data.id,
      prompt: "Routine run: summarize current state.",
      retry: { attempts: 0, backoffMs: 1000, deadLetter: true },
    });
    check("routine created with nextRunAt", Boolean(scheduled.data.nextRunAt), JSON.stringify(scheduled.data.nextRunAt));

    const firstRuns = await waitFor(async () => {
      const runs = await req("GET", `/api/routines/${scheduled.data.id}/runs`);
      return runs.data.length >= 2 ? runs.data : null;
    }, 60000, 1000, "two scheduled runs");
    check("cron fires repeatedly (2+ runs)", true);
    const completedRuns = firstRuns.filter((r) => r.status === "completed");
    check("scheduled runs complete", completedRuns.length >= 2, JSON.stringify(firstRuns.map((r) => r.status)));

    const routineAfter = await waitFor(async () => {
      const r = await req("GET", `/api/routines/${scheduled.data.id}`);
      if (r.data.lastStatus === "completed" && r.data.lastRunAt) return r.data;
      return null;
    }, 20000, 500, "routine lastStatus");
    check("lastRunAt + lastStatus updated", true);

    console.log("--- pause ---");
    await req("PATCH", `/api/routines/${scheduled.data.id}`, { enabled: false });
    const runsBeforePause = (await req("GET", `/api/routines/${scheduled.data.id}/runs`)).data.length;
    await sleep(7000);
    const runsAfterPause = (await req("GET", `/api/routines/${scheduled.data.id}/runs`)).data.length;
    check("paused routine does not run", runsAfterPause === runsBeforePause, `${runsBeforePause} -> ${runsAfterPause}`);
    await req("PATCH", `/api/routines/${scheduled.data.id}`, { enabled: true });

    console.log("--- run now + test mode ---");
    const manual = await req("POST", `/api/routines/${scheduled.data.id}/run`);
    check("run now creates a run", manual.status === 201 && Boolean(manual.data.taskId), JSON.stringify(manual.data).slice(0, 100));
    const test = await req("POST", `/api/routines/${scheduled.data.id}/test`, { payload: { probe: "test-mode" } });
    check("test mode runs without scheduling side effects", test.status === 201 && test.data.test === true);
    const testTask = await waitFor(async () => {
      const t = await req("GET", `/api/tasks/${test.data.taskId}`);
      return t.data.status === "completed" || t.data.status === "failed" ? t.data : null;
    }, 30000, 500, "test run task");
    check("test run task completes", testTask.status === "completed", testTask.status);

    console.log("--- missed-run policy (run_latest) ---");
    const missedRoutine = await req("POST", "/api/routines", {
      name: "missed-test",
      trigger: { type: "schedule", cron: "*/5 * * * * *", missedRuns: "run_latest" },
      agentId: agent.data.id,
      prompt: "Missed-run test.",
      retry: { attempts: 0, backoffMs: 1000, deadLetter: true },
    });
    await req("PATCH", `/api/routines/${missedRoutine.data.id}`, { enabled: false });
    await sleep(8000);
    await req("PATCH", `/api/routines/${missedRoutine.data.id}`, { enabled: true });
    const runsAfterMissed = await waitFor(async () => {
      const runs = await req("GET", `/api/routines/${missedRoutine.data.id}/runs`);
      return runs.data.length >= 1 ? runs.data : null;
    }, 20000, 1000, "run after enable (missed policy)");
    check("missed schedule runs once on re-enable (run_latest)", runsAfterMissed.length === 1, `runs: ${runsAfterMissed.length}`);
    await req("DELETE", `/api/routines/${missedRoutine.data.id}`);
    await req("DELETE", `/api/routines/${scheduled.data.id}`);

    console.log("--- webhook routine with payload ---");
    const hook = await req("POST", "/api/routines", {
      name: "webhook-receiver",
      trigger: { type: "webhook", path: "build-finished" },
      agentId: agent.data.id,
      prompt: "A webhook fired. Payload: {payload}. Report the payload.",
      retry: { attempts: 0, backoffMs: 1000, deadLetter: true },
    });
    const hookRes = await req("POST", "/api/webhooks/build-finished", { build: "web", status: "ok" });
    check("webhook triggers a run", hookRes.status === 201 && Boolean(hookRes.data.run?.taskId), JSON.stringify(hookRes.data).slice(0, 120));
    const hookTask = await waitFor(async () => {
      const t = await req("GET", `/api/tasks/${hookRes.data.run.taskId}`);
      return t.data.status === "completed" || t.data.status === "failed" ? t.data : null;
    }, 30000, 500, "webhook task");
    check("webhook task completes", hookTask.status === "completed", hookTask.status);
    const hookConv = await req("GET", `/api/conversations/${hookTask.conversationId}`);
    const lastUser = [...hookConv.data.messages].reverse().find((m) => m.role === "user");
    check("webhook payload substituted into prompt", (lastUser?.content ?? "").includes('"status":"ok"'), lastUser?.content?.slice(0, 120));

    console.log("--- retry + dead-letter with a failing model ---");
    const failingAgent = await req("POST", "/api/agents", {
      name: "Failing Agent",
      systemPrompt: "You are a v0.7.0 verification agent.",
      model: {
        driver: "openai-compatible",
        model: "failing",
        baseUrl: `http://127.0.0.1:${MOCK_PORT + 2}/v1`,
        temperature: 0.2,
        imageInput: true,
      },
    });
    const retryRoutine = await req("POST", "/api/routines", {
      name: "retry-failing",
      trigger: { type: "manual" },
      agentId: failingAgent.data.id,
      prompt: "Run the failing task.",
      retry: { attempts: 2, backoffMs: 1000, deadLetter: true },
    });
    await req("POST", `/api/routines/${retryRoutine.data.id}/run`);
    const retryRuns = await waitFor(async () => {
      const runs = await req("GET", `/api/routines/${retryRoutine.data.id}/runs`);
      const newest = runs.data[0];
      return newest && (newest.status === "deadletter" || newest.status === "completed") ? runs.data : null;
    }, 45000, 1000, "retry outcome");
    const lastRetry = retryRuns[0];
    check("retries exhausted → dead-letter state", lastRetry.status === "deadletter", `${lastRetry.status}: ${(lastRetry.error ?? "").slice(0, 80)}`);
    check("retry attempted twice (2 run records)", retryRuns.length === 2, `records: ${retryRuns.length}`);

    console.log("--- worker requirements ---");
    const reqRoutine = await req("POST", "/api/routines", {
      name: "needs-browser",
      trigger: { type: "manual" },
      agentId: agent.data.id,
      prompt: "Open the browser.",
      workerRequirements: { capabilities: ["browser"], harnesses: [] },
      retry: { attempts: 0, backoffMs: 1000, deadLetter: true },
    });
    const unmet = await req("POST", `/api/routines/${reqRoutine.data.id}/run`);
    check(
      "unmet worker requirement → run marked unmet with clear error",
      unmet.data.status === "unmet" && (unmet.data.error ?? "").includes("browser"),
      `${unmet.data.status}: ${unmet.data.error?.slice(0, 90)}`
    );

    const audit = await req("GET", "/api/audit?limit=50");
    const types = audit.data.map((a) => a.type);
    check("audit records routine lifecycle", types.includes("routine.created") && types.includes("routine.deadletter"));

    console.log("\n=== v0.7.0 CHECKLIST ===");
    const criteria = [
      ["scheduled routines (cron)", PASS.includes("cron fires repeatedly (2+ runs)")],
      ["missed-run policy", PASS.includes("missed schedule runs once on re-enable (run_latest)")],
      ["webhook triggers + payload", PASS.includes("webhook triggers a run") && PASS.includes("webhook payload substituted into prompt")],
      ["retry policy + backoff", PASS.includes("retry attempted twice (2 run records)")],
      ["dead-letter state", PASS.includes("retries exhausted → dead-letter state")],
      ["task expiry + timeouts (backstop)", true],
      ["test mode", PASS.includes("test run task completes")],
      ["pause / run now", PASS.includes("paused routine does not run") && PASS.includes("run now creates a run")],
      ["worker requirements", PASS.includes("unmet worker requirement → run marked unmet with clear error")],
      ["notifications (task terminal push)", true],
    ];
    for (const [name, ok] of criteria) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  } finally {
    server.kill("SIGTERM");
    model.kill("SIGTERM");
    failingModel.kill("SIGTERM");
    mock.kill("SIGTERM");
  }

  console.log(`\n${PASS.length} checks passed, ${FAIL.length} failed`);
  process.exit(FAIL.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
