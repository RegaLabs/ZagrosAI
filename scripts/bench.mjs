import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PORT = 8789;
const MOCK_PORT = 18000 + (Date.now() % 8000);
const TASKS = Number(process.env.BENCH_TASKS ?? 20);
const WORKDIR = join(tmpdir(), `zagros-bench-${Date.now()}`);

async function main() {
  mkdirSync(WORKDIR, { recursive: true });
  const model = spawn("node", ["scripts/mock-model.mjs"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_MODEL_PORT: String(MOCK_PORT), MOCK_FLOW: "memory", MOCK_REPLY: "bench-ok" },
    stdio: "ignore",
  });
  const server = spawn("pnpm", ["--filter", "@zagros/server", "start"], {
    cwd: ROOT,
    env: {
      ...process.env,
      ZAGROS_DATA: join(WORKDIR, "data"),
      ZAGROS_HOST: "127.0.0.1",
      ZAGROS_PORT: String(PORT),
      ZAGROS_MASTER_KEY: "bench-master-key",
      ZAGROS_RUNNER_TOKEN: "bench-token",
      ZAGROS_PUBLIC_URL: `http://127.0.0.1:${PORT}`,
    },
    stdio: "ignore",
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    for (let i = 0; i < 60; i++) {
      const ok = await fetch(`http://127.0.0.1:${PORT}/api/health`).then((r) => r.ok).catch(() => false);
      if (ok) break;
      await sleep(500);
    }
    const settings = await fetch(`http://127.0.0.1:${PORT}/api/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ defaultModel: { driver: "openai-compatible", model: "bench", baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`, temperature: 0.2, imageInput: true } }) });
    if (!settings.ok) throw new Error("settings failed");
    const agent = await (await fetch(`http://127.0.0.1:${PORT}/api/agents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Bench Agent" }) })).json();
    const conversation = await (await fetch(`http://127.0.0.1:${PORT}/api/conversations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentId: agent.id }) })).json();

    const latencies = [];
    let succeeded = 0;
    let modelCalls = 0;
    let toolCalls = 0;
    const start = Date.now();
    for (let i = 0; i < TASKS; i++) {
      const taskStart = Date.now();
      const sent = await fetch(`http://127.0.0.1:${PORT}/api/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: `Bench task ${i}` }),
      });
      const body = await sent.json();
      if (!body.task?.id) {
        latencies.push(Date.now() - taskStart);
        continue;
      }
      for (;;) {
        const task = await (await fetch(`http://127.0.0.1:${PORT}/api/tasks/${body.task.id}`)).json();
        if (task.status === "completed" || task.status === "failed") {
          latencies.push(Date.now() - taskStart);
          if (task.status === "completed") succeeded++;
          modelCalls += task.modelCalls;
          toolCalls += task.toolCalls;
          break;
        }
        await sleep(100);
      }
    }
    const total = Date.now() - start;
    const sorted = [...latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const report = {
      tasks: TASKS,
      succeeded,
      successRate: Math.round((succeeded / TASKS) * 100),
      totalMs: total,
      avgMs: Math.round(total / TASKS),
      p50Ms: p50,
      p95Ms: p95,
      modelCalls,
      toolCalls,
    };
    console.log("BENCH " + JSON.stringify(report));
    process.exit(succeeded === TASKS ? 0 : 1);
  } finally {
    server.kill("SIGTERM");
    model.kill("SIGTERM");
    spawnSync("pkill", ["-f", "dist/index.js"], { stdio: "ignore" });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
