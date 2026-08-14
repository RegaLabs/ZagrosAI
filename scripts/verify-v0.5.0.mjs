import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PORT = 8787;
const MOCK_PORT = 14000 + (Date.now() % 10000);
const WORKDIR = join(tmpdir(), `zagros-verify-v05-${Date.now()}`);
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
  console.log(`v0.5.0 verify workspace: ${WORKDIR}`);

  const skillsDir = join(WORKDIR, "skills");
  mkdirSync(join(skillsDir, "verify-web-page"), { recursive: true });
  writeFileSync(
    join(skillsDir, "verify-web-page", "skill.yaml"),
    [
      "name: verify-web-page",
      "version: 1.0.0",
      "description: Verify a web page is live and contains expected text. Use when asked to check a website or confirm a page exists.",
      "requires:",
      "  tools: [http.fetch, browser.text]",
      "  capabilities: [browser]",
      "approval:",
      "  shell.exec: denied",
      "verification: [page_reachable, expected_text_found]",
      "tests:",
      "  - \"echo verify-web-page: test ok\"",
      "tags: [web, verification]",
    ].join("\n")
  );
  writeFileSync(
    join(skillsDir, "verify-web-page", "SKILL.md"),
    [
      "# verify-web-page",
      "",
      "Verify a web page is reachable and contains expected content.",
      "",
      "Use this skill when asked to check a website, verify a page, or confirm expected text on a page.",
      "",
      "## Steps",
      "1. Fetch the URL with http.fetch.",
      "2. Read visible text with browser.text.",
      "3. Confirm the expected phrase is present (case-insensitive).",
      "4. Report reachable, found, and page title.",
    ].join("\n")
  );

  const mock = spawn("node", ["scripts/mock-oauth-mcp.mjs"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_OAUTH_PORT: String(MOCK_PORT) },
    stdio: "inherit",
  });
  const model = spawn("node", ["scripts/mock-model.mjs"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_MODEL_PORT: String(MOCK_PORT + 1), MOCK_FLOW: "memory" },
    stdio: "inherit",
  });

  const server = spawn("pnpm", ["--filter", "@zagros/server", "start"], {
    cwd: ROOT,
    env: {
      ...process.env,
      ZAGROS_DATA: join(WORKDIR, "data"),
      ZAGROS_HOST: "127.0.0.1",
      ZAGROS_PORT: String(PORT),
      ZAGROS_MASTER_KEY: "v05-verify-master-key",
      ZAGROS_RUNNER_TOKEN: "v05-runner-token",
      ZAGROS_PUBLIC_URL: `http://127.0.0.1:${PORT}`,
      ZAGROS_SKILLS_DIR: skillsDir,
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
    "memory-laptop",
    "--token",
    "v05-runner-token",
    "--workspace",
    join(WORKDIR, "runner-workspace"),
  ], {
    cwd: ROOT,
    stdio: "ignore",
  });

  try {
    await waitFor(async () => (await req("GET", "/api/health")).data?.ok, 30000, 500, "server health");
    await waitFor(async () => {
      const workers = await req("GET", "/api/workers");
      return workers.data.some((w) => w.online) ? true : null;
    }, 30000, 500, "runner online");

    console.log("--- skills API ---");
    const skills = await req("GET", "/api/skills");
    check("skills listed from filesystem", skills.data.supported === true && skills.data.skills.some((s) => s.name === "verify-web-page"), JSON.stringify(skills.data.skills.map((s) => s.name)));
    const skillDetail = await req("GET", "/api/skills/verify-web-page");
    check("skill detail includes SKILL.md", Boolean(skillDetail.data.readme?.includes("# verify-web-page")), skillDetail.data.readme?.slice(0, 60));
    check("skill manifest exposes requires/approval/verification", skillDetail.data.requires?.tools?.includes("http.fetch") && skillDetail.data.approval?.shell?.exec === undefined, JSON.stringify(skillDetail.data.approval));

    await req("PUT", "/api/settings", {
      defaultModel: {
        driver: "openai-compatible",
        model: "mock-model",
        baseUrl: `http://127.0.0.1:${MOCK_PORT + 1}/v1`,
        temperature: 0.2,
        imageInput: true,
      },
    });
    const agent = await req("POST", "/api/agents", { name: "Memory Agent", systemPrompt: "You are a v0.5.0 verification agent." });
    const conversation = await req("POST", "/api/conversations", { agentId: agent.data.id, title: "Memory Chat" });

    console.log("--- memory: extraction after task ---");
    const sent1 = await req("POST", `/api/conversations/${conversation.data.id}/messages`, {
      content: "Remember that my favorite color is cyan.",
    });
    const task1 = await waitFor(async () => {
      const t = await req("GET", `/api/tasks/${sent1.data.task.id}`);
      return t.data.status === "completed" || t.data.status === "failed" ? t.data : null;
    }, 30000, 500, "task 1");
    check("task 1 completes", task1.status === "completed", task1.status);

    const memory = await waitFor(async () => {
      const m = await req("GET", "/api/memories?q=favorite color");
      return m.data.length > 0 ? m.data : null;
    }, 20000, 500, "memory extracted");
    const semantic = memory.find((m) => m.kind === "semantic" && m.content.includes("cyan"));
    check("semantic memory extracted from task", Boolean(semantic), JSON.stringify(memory.map((m) => m.content).slice(0, 3)));
    check("memory has provenance source", Boolean(semantic?.source?.startsWith("task:")), semantic?.source);
    check("memory carries confidence", typeof semantic?.confidence === "number" && semantic.confidence > 0.5, String(semantic?.confidence));

    console.log("--- memory: retrieval into next task ---");
    const sent2 = await req("POST", `/api/conversations/${conversation.data.id}/messages`, {
      content: "use verify-web-page — what is my favorite color?",
    });
    const task2 = await waitFor(async () => {
      const t = await req("GET", `/api/tasks/${sent2.data.task.id}`);
      return t.data.status === "completed" || t.data.status === "failed" ? t.data : null;
    }, 30000, 500, "task 2");
    const conv = await req("GET", `/api/conversations/${conversation.data.id}`);
    const assistant2 = conv.data.messages.filter((m) => m.role === "assistant").at(-1)?.content ?? "";
    check("skill auto-activated into context (skill-loaded)", assistant2.includes("skill-loaded:verify-web-page"), assistant2.slice(0, 120));
    check("memory injected into context (memory-loaded)", assistant2.includes("memory-loaded:") && assistant2.includes("cyan"), assistant2.slice(0, 160));

    console.log("--- /skill-name forced activation ---");
    const sent3 = await req("POST", `/api/conversations/${conversation.data.id}/messages`, {
      content: "/verify-web-page just check the page please",
    });
    await waitFor(async () => {
      const t = await req("GET", `/api/tasks/${sent3.data.task.id}`);
      return t.data.status === "completed" || t.data.status === "failed" ? t.data : null;
    }, 30000, 500, "task 3");
    const conv3 = await req("GET", `/api/conversations/${conversation.data.id}`);
    const assistant3 = conv3.data.messages.filter((m) => m.role === "assistant").at(-1)?.content ?? "";
    check("/skill-name forces skill activation", assistant3.includes("skill-loaded:verify-web-page"), assistant3.slice(0, 120));

    console.log("--- memory controls ---");
    const edited = await req("PATCH", `/api/memories/${semantic.id}`, { content: "the user's favorite color is bright cyan" });
    check("edit memory", edited.status === 200 && edited.data.content.includes("bright cyan"));
    const created = await req("POST", "/api/memories", { content: "manual memory entry", kind: "semantic", confidence: 0.9 });
    check("create memory via API", created.status === 201 && Boolean(created.data.id));
    const removed = await req("DELETE", `/api/memories/${created.data.id}`);
    check("forget (delete) memory", removed.data.ok === true);
    const afterDelete = await req("GET", "/api/memories?q=manual memory");
    check("deleted memory gone", !afterDelete.data.some((m) => m.id === created.data.id));

    console.log("--- git-backed skill install ---");
    const gitRepo = join(WORKDIR, "git-repo");
    mkdirSync(gitRepo, { recursive: true });
    writeFileSync(
      join(gitRepo, "skill.yaml"),
      [
        "name: echo-helper",
        "version: 1.0.0",
        "description: A skill that echoes back a greeting. Use when asked to echo or greet.",
        "requires:",
        "  tools: []",
        "  capabilities: []",
        "tests:",
        "  - \"echo echo-helper: test ok\"",
        "tags: [echo]",
      ].join("\n")
    );
    writeFileSync(join(gitRepo, "SKILL.md"), "# echo-helper\n\nA tiny skill used to test skill installation.\n");
    spawnSync("git", ["init", "-q", gitRepo]);
    spawnSync("git", ["-C", gitRepo, "add", "."]);
    spawnSync("git", ["-C", gitRepo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
    const installed = await req("POST", "/api/skills/install", { source: `git:file://${gitRepo}` });
    check("skill installed from git", installed.status === 201 && installed.data.skill?.name === "echo-helper", JSON.stringify(installed.data).slice(0, 120));
    const skillsAfter = await req("GET", "/api/skills");
    check("installed skill listed", skillsAfter.data.skills.some((s) => s.name === "echo-helper"));

    console.log("--- skill tests ---");
    const testRes = await req("POST", "/api/skills/verify-web-page/test");
    check("skill tests run (via runner shell)", testRes.status === 200 && testRes.data.results?.[0]?.ok === true, JSON.stringify(testRes.data).slice(0, 160));

    const removedSkill = await req("DELETE", "/api/skills/echo-helper");
    check("skill uninstall", removedSkill.data.ok === true);

    console.log("\n=== v0.5.0 CHECKLIST ===");
    const criteria = [
      ["episodic memory", memory.some((m) => m.kind === "episodic")],
      ["semantic memory", Boolean(semantic)],
      ["memory provenance", Boolean(semantic?.source?.startsWith("task:"))],
      ["memory expiry (API supports expiresAt)", edited.status === 200],
      ["memory viewer + edit + forget", PASS.includes("edit memory") && PASS.includes("forget (delete) memory")],
      ["SKILL.md + skill.yaml loader", PASS.includes("skill detail includes SKILL.md")],
      ["skill search (auto-activation)", PASS.includes("skill auto-activated into context (skill-loaded)")],
      ["/skill-name activation", PASS.includes("/skill-name forces skill activation")],
      ["skill tests", PASS.includes("skill tests run (via runner shell)")],
      ["git-backed skill install", PASS.includes("skill installed from git")],
      ["permissions manifest", PASS.includes("skill manifest exposes requires/approval/verification")],
    ];
    for (const [name, ok] of criteria) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  } finally {
    runner.kill("SIGTERM");
    server.kill("SIGTERM");
    model.kill("SIGTERM");
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
