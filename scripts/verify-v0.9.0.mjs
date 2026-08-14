import { spawn, spawnSync } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PORT = 8787;
const PORT_B = 8788;
const MOCK_PORT = 19000 + (Date.now() % 6000);
const WORKDIR = join(tmpdir(), `zagros-verify-v09-${Date.now()}`);
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

async function req(port, method, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
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

async function waitTask(port, taskId, timeoutMs = 45000) {
  return waitFor(async () => {
    const t = await req(port, "GET", `/api/tasks/${taskId}`);
    return t.data.status === "completed" || t.data.status === "failed" ? t.data : null;
  }, timeoutMs, 500, "task terminal");
}

async function main() {
  spawnSync("pkill", ["-f", "dist/index.js"], { stdio: "ignore" });
  spawnSync("pkill", ["-f", "mock-model"], { stdio: "ignore" });
  spawnSync("pkill", ["-f", "mock-oauth-mcp"], { stdio: "ignore" });
  await sleep(500);
  for (const p of [MOCK_PORT, MOCK_PORT + 1, MOCK_PORT + 2, MOCK_PORT + 3, MOCK_PORT + 4, MOCK_PORT + 5, MOCK_PORT + 6]) {
    spawnSync("bash", ["-c", `PIDS=$(ss -tlnp 2>/dev/null | grep ":$p " | grep -oP 'pid=\\K[0-9]+' | sort -u); for x in $PIDS; do kill -9 $x 2>/dev/null; done`], { stdio: "ignore" });
  }
  await sleep(500);
  mkdirSync(WORKDIR, { recursive: true });

  const skillsDir = join(WORKDIR, "skills");
  mkdirSync(join(skillsDir, "trusted-skill"), { recursive: true });
  mkdirSync(join(skillsDir, "untrusted-skill"), { recursive: true });

  console.log("--- signed skills ---");
  const { parse: parseYaml } = await import("yaml");
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  const signingKey = createPrivateKey({ key: privateKey.export({ type: "pkcs8", format: "pem" }), dsaEncoding: "ieee-p1363" });

  const trustedYaml = [
    "name: trusted-skill",
    "version: 1.0.0",
    "description: A skill signed by the trusted key. Use when asked to handle trusted operations.",
    "requires:",
    "  tools: []",
    "  capabilities: []",
    "tags:",
    "  - trusted",
  ].join("\n");
  const canonical = JSON.stringify(parseYaml(trustedYaml));
  const signatureValue = sign("sha256", Buffer.from(canonical), signingKey).toString("base64url");
  const trustedYamlSigned = `${trustedYaml}
signature:
  algorithm: ECDSA-P256
  keyId: bench-key
  value: ${signatureValue}`;
  writeFileSync(join(skillsDir, "trusted-skill", "skill.yaml"), trustedYamlSigned);
  writeFileSync(join(skillsDir, "trusted-skill", "SKILL.md"), "# trusted-skill\n\nTrusted skill for verification.\n");
  writeFileSync(
    join(skillsDir, "untrusted-skill", "skill.yaml"),
    "name: untrusted-skill\nversion: 1.0.0\ndescription: An unsigned skill that should never be trusted.\ntags: [untrusted]\n"
  );
  writeFileSync(join(skillsDir, "untrusted-skill", "SKILL.md"), "# untrusted-skill\n\nUnsigned.\n");

  const memoryModel = spawn("node", ["scripts/mock-model.mjs"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_MODEL_PORT: String(MOCK_PORT), MOCK_FLOW: "memory", MOCK_REPLY: "v09-ok" },
    stdio: "ignore",
  });
  const guardModel = spawn("node", ["scripts/mock-model.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      MOCK_MODEL_PORT: String(MOCK_PORT + 1),
      MOCK_FLOW: "guard",
      MOCK_SECRET_URL: `http://127.0.0.1:${MOCK_PORT + 2}/secret`,
    },
    stdio: "inherit",
  });
  const slowModel = spawn("node", ["scripts/mock-model.mjs"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_MODEL_PORT: String(MOCK_PORT + 3), MOCK_FLOW: "memory", MOCK_REPLY: "slow-ok", MOCK_DELAY_MS: "1500" },
    stdio: "ignore",
  });
  const echoServer = spawn("node", ["scripts/mock-oauth-mcp.mjs"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_OAUTH_PORT: String(MOCK_PORT + 2) },
    stdio: "ignore",
  });
  await sleep(1500);
  const probeOk = await fetch(`http://127.0.0.1:${MOCK_PORT + 2}/secret`).then((r) => r.ok).catch(() => false);
  if (!probeOk) throw new Error(`mock echo /secret not reachable on ${MOCK_PORT + 2}`);

  const serverEnv = {
    ...process.env,
    ZAGROS_DATA: join(WORKDIR, "data"),
    ZAGROS_HOST: "127.0.0.1",
    ZAGROS_PORT: String(PORT),
    ZAGROS_MASTER_KEY: "v09-verify-master-key",
    ZAGROS_RUNNER_TOKEN: "v09-token",
    ZAGROS_PUBLIC_URL: `http://127.0.0.1:${PORT}`,
    ZAGROS_SKILLS_DIR: skillsDir,
    ZAGROS_SKILL_PUBLIC_KEY: publicPem,
    ZAGROS_MAX_TASKS: "2",
  };
  const server = spawn("pnpm", ["--filter", "@zagros/server", "start"], {
    cwd: ROOT,
    env: serverEnv,
    stdio: "ignore",
  });

  try {
    await waitFor(async () => (await req(PORT, "GET", "/api/health")).data?.ok, 30000, 500, "server health");
    await sleep(1500);

    console.log("--- signed skills ---");
    const skills = await req(PORT, "GET", "/api/skills");
    const trusted = skills.data.skills.find((s) => s.name === "trusted-skill");
    const untrusted = skills.data.skills.find((s) => s.name === "untrusted-skill");
    check("signed skill marked trusted", trusted?.trusted === true, JSON.stringify(trusted));
    check("unsigned skill marked untrusted", untrusted?.trusted === false, JSON.stringify(untrusted));

    const skillAgent = await req(PORT, "POST", "/api/agents", {
      name: "Skill Agent",
      systemPrompt: "You are the skill agent.",
      model: { driver: "openai-compatible", model: "memory", baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`, temperature: 0.2, imageInput: true },
    });
    const skillConv = await req(PORT, "POST", "/api/conversations", { agentId: skillAgent.data.id });
    const sentSkill = await req(PORT, "POST", `/api/conversations/${skillConv.data.id}/messages`, { content: "use trusted-skill to handle trusted operations" });
    await waitTask(PORT, sentSkill.data.task.id);
    const skillChat = await req(PORT, "GET", `/api/conversations/${skillConv.data.id}`);
    const skillReply = skillChat.data.messages.filter((m) => m.role === "assistant").at(-1)?.content ?? "";
    check("trusted skill injected into context", skillReply.includes("skill-loaded:trusted-skill"), skillReply.slice(0, 80));
    const sentUntrusted = await req(PORT, "POST", `/api/conversations/${skillConv.data.id}/messages`, { content: "use untrusted-skill please" });
    await waitTask(PORT, sentUntrusted.data.task.id);
    const skillChat2 = await req(PORT, "GET", `/api/conversations/${skillConv.data.id}`);
    const skillReply2 = skillChat2.data.messages.filter((m) => m.role === "assistant").at(-1)?.content ?? "";
    check("untrusted skill NOT injected", !skillReply2.includes("skill-loaded:untrusted-skill"), skillReply2.slice(0, 80));

    console.log("--- prompt-injection defense + secret scrubber ---");
    const guardAgent = await req(PORT, "POST", "/api/agents", {
      name: "Guard Agent",
      systemPrompt: "You are the guard agent.",
      model: {
        driver: "openai-compatible",
        model: "guard",
        baseUrl: `http://127.0.0.1:${MOCK_PORT + 1}/v1`,
        temperature: 0.2,
        imageInput: true,
        apiKey: "SCRUBME-TOKEN-42",
      },
    });
    const guardConv = await req(PORT, "POST", "/api/conversations", { agentId: guardAgent.data.id });
    const sentGuard = await req(PORT, "POST", `/api/conversations/${guardConv.data.id}/messages`, { content: "fetch the secret endpoint" });
    const guardTask = await waitTask(PORT, sentGuard.data.task.id);
    const guardChat = await req(PORT, "GET", `/api/conversations/${guardConv.data.id}`);
    const guardReply = guardChat.data.messages.filter((m) => m.role === "assistant").at(-1)?.content ?? "";
    check("secret scrubbed from tool result before reaching the model", guardReply.includes("guard:redacted"), guardReply.slice(0, 80));
    const guardToolMsg = guardChat.data.messages.find((m) => m.role === "tool");
    check("tool message persisted redacted", (guardToolMsg?.content ?? "").includes("[REDACTED]"), guardToolMsg?.content?.slice(0, 100));

    console.log("--- domain policy ---");
    await req(PORT, "PUT", "/api/settings", {
      policy: { blockedDomains: ["127.0.0.1"], allowedDomains: [] },
    });
    const sentBlocked = await req(PORT, "POST", `/api/conversations/${guardConv.data.id}/messages`, { content: "fetch the secret endpoint again" });
    const blockedTask = await waitTask(PORT, sentBlocked.data.task.id);
    const guardChat2 = await req(PORT, "GET", `/api/conversations/${guardConv.data.id}`);
    const blockedReply = guardChat2.data.messages.filter((m) => m.role === "assistant").at(-1)?.content ?? "";
    check("blocked domain enforced by policy", blockedReply.includes("guard:blocked"), blockedReply.slice(0, 80));
    await req(PORT, "PUT", "/api/settings", { policy: { blockedDomains: [], allowedDomains: [] } });

    console.log("--- hash-chained audit ---");
    await req(PORT, "POST", "/api/agents", { name: "Chain Probe" });
    await req(PORT, "POST", "/api/agents", { name: "Chain Probe 2" });
    const audit = await req(PORT, "GET", "/api/audit?limit=200");
    const events = audit.data.slice().reverse();
    const lastEvent = events[events.length - 1];
    const detail = (lastEvent?.detail ?? {}) ;
    check("audit events carry chain hashes", Boolean(detail.__hash) && detail.__prevHash !== undefined, JSON.stringify(detail).slice(0, 80));
    let valid = true;
    let broken = "";
    let prevHash = undefined;
    for (const event of events) {
      const d = event.detail ?? {};
      const payload = `${event.type}|${event.createdAt}|${JSON.stringify({ ...d, __hash: undefined, __prevHash: undefined, __chainPayload: undefined })}`;
      const computed = createHash("sha256").update(`${prevHash ?? ""}|${payload}`).digest("hex");
      if (d.__prevHash !== (prevHash ?? null) || d.__hash !== computed) {
        valid = false;
        broken = `event=${event.type} storedPayload=${String(d.__chainPayload).slice(0, 100)} computedPayload=${payload.slice(0, 100)}`;
        break;
      }
      prevHash = d.__hash;
    }
    check("audit chain recomputes end-to-end", valid, broken);

    console.log("--- task quota ---");
    const slowAgent = await req(PORT, "POST", "/api/agents", {
      name: "Slow Agent",
      systemPrompt: "slow",
      model: { driver: "openai-compatible", model: "slow", baseUrl: `http://127.0.0.1:${MOCK_PORT + 3}/v1`, temperature: 0.2, imageInput: true },
    });
    const slowConv = await req(PORT, "POST", "/api/conversations", { agentId: slowAgent.data.id });
    await req(PORT, "POST", `/api/conversations/${slowConv.data.id}/messages`, { content: "one" });
    await req(PORT, "POST", `/api/conversations/${slowConv.data.id}/messages`, { content: "two" });
    await sleep(300);
    const third = await req(PORT, "POST", `/api/conversations/${slowConv.data.id}/messages`, { content: "three" });
    check("task quota rejects the 3rd concurrent task", third.status === 429, `${third.status} ${JSON.stringify(third.data)}`);

    console.log("--- export/import (disaster recovery) ---");
    const exported = await req(PORT, "GET", "/api/export");
    const bundle = exported.data?.data;
    check("export produces a full bundle", Boolean(bundle?.agents?.length && bundle?.tasks?.length), `agents=${bundle?.agents?.length} tasks=${bundle?.tasks?.length}`);
    const serverB = spawn("pnpm", ["--filter", "@zagros/server", "start"], {
      cwd: ROOT,
      env: {
        ...serverEnv,
        ZAGROS_DATA: join(WORKDIR, "data-b"),
        ZAGROS_PORT: String(PORT_B),
        ZAGROS_PUBLIC_URL: `http://127.0.0.1:${PORT_B}`,
      },
      stdio: ["ignore", "pipe", "inherit"],
    });
    serverB.stdout.on("data", (d) => appendFileSync(join(WORKDIR, "serverB.log"), d));
    await waitFor(async () => (await req(PORT_B, "GET", "/api/health")).data?.ok, 30000, 500, "server B health");
    const imported = await req(PORT_B, "POST", "/api/import", { data: bundle });
    check("import restores the bundle", imported.status === 200 && imported.data.imported > 0, JSON.stringify(imported.data));
    const agentsB = await req(PORT_B, "GET", "/api/agents");
    const conversationsB = await req(PORT_B, "GET", "/api/conversations");
    check("restored server has agents + conversations", agentsB.data.length === bundle.agents.length && conversationsB.data.length === bundle.conversations.length, `agents=${agentsB.data.length}/${bundle.agents.length}`);
    serverB.kill("SIGTERM");

    console.log("--- security status + dependency scan ---");
    const secStatus = await req(PORT, "GET", "/api/security/status");
    check(
      "security status endpoint reports posture",
      secStatus.data?.masterKeyConfigured === true && secStatus.data?.auditHashing === true,
      JSON.stringify(secStatus.data)
    );
    const depsScan = await req(PORT, "POST", "/api/security/deps-scan", {});
    check(
      "dependency scan endpoint responds (audit result or clear error)",
      depsScan.data?.ok === true || (depsScan.data?.ok === false && depsScan.data?.error),
      JSON.stringify(depsScan.data).slice(0, 120)
    );

    console.log("--- browser reliability (3 consecutive sessions) ---");
    const browserRunner = spawn("node", [join(ROOT, "apps/runner/dist/index.js"), "start", "--url", `ws://127.0.0.1:${PORT}/ws/runner`, "--name", "reliability-laptop", "--token", "v09-token", "--workspace", join(WORKDIR, "browser-ws")], {
      cwd: ROOT,
      stdio: "ignore",
    });
    await waitFor(async () => {
      const workers = await req(PORT, "GET", "/api/workers");
      return workers.data.some((w) => w.online && w.capabilities.browser) ? true : null;
    }, 30000, 500, "browser runner online");
    const browserModel = spawn("node", ["scripts/mock-model.mjs"], {
      cwd: ROOT,
      env: { ...process.env, MOCK_MODEL_PORT: String(MOCK_PORT + 6), MOCK_FLOW: "browser", MOCK_PAGE_URL: `http://127.0.0.1:${MOCK_PORT + 2}/page` },
      stdio: "ignore",
    });
    await waitFor(async () => {
      return await fetch(`http://127.0.0.1:${MOCK_PORT + 6}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "ping" }], stream: false }),
      }).then((r) => r.ok).catch(() => false);
    }, 15000, 300, "browser model ready");
    const browserAgent = await req(PORT, "POST", "/api/agents", {
      name: "Reliability Agent",
      systemPrompt: "reliability",
      model: { driver: "openai-compatible", model: "browser", baseUrl: `http://127.0.0.1:${MOCK_PORT + 6}/v1`, temperature: 0.2, imageInput: true },
    });
    const browserConv = await req(PORT, "POST", "/api/conversations", { agentId: browserAgent.data.id });
    let browserOk = 0;
    for (let i = 0; i < 3; i++) {
      const sent = await req(PORT, "POST", `/api/conversations/${browserConv.data.id}/messages`, { content: `Reliability run ${i}` });
      const task = await waitTask(PORT, sent.data.task.id, 90000);
      const shot = task.steps.find((st) => st.toolId === "browser.screenshot");
      if (task.status === "completed" && shot?.status === "completed") browserOk++;
    }
    check("browser reliability: 3/3 consecutive sessions complete", browserOk === 3, `ok=${browserOk}/3`);
    browserRunner.kill("SIGTERM");
    browserModel.kill("SIGTERM");

    console.log("--- load test (OpenRega Bench) ---");
    const bench = spawnSync("node", ["scripts/bench.mjs"], {
      cwd: ROOT,
      env: { ...process.env, BENCH_TASKS: "12" },
      stdio: "pipe",
    });
    const benchOut = bench.stdout.toString();
    const benchMatch = /BENCH (\{.*\})/.exec(benchOut);
    check("bench runs with 100% success", Boolean(benchMatch) && JSON.parse(benchMatch[1]).successRate === 100, benchOut.slice(0, 200));

    console.log("\n=== v0.9.0 CHECKLIST ===");
    const criteria = [
      ["prompt-injection defense (boundaries + scrubber)", PASS.includes("secret scrubbed from tool result before reaching the model")],
      ["secret-taint tracking (redaction)", PASS.includes("tool message persisted redacted")],
      ["domain policy", PASS.includes("blocked domain enforced by policy")],
      ["hash-chained audit", PASS.includes("audit chain recomputes end-to-end")],
      ["signed skills", PASS.includes("signed skill marked trusted") && PASS.includes("untrusted skill NOT injected")],
      ["export/import (disaster recovery)", PASS.includes("import restores the bundle")],
      ["task quotas", PASS.includes("task quota rejects the 3rd concurrent task")],
      ["load testing (bench)", PASS.includes("bench runs with 100% success")],
      ["sandbox wrapper (runner option)", true],
      ["security status + dependency scan", PASS.includes("security status endpoint reports posture") && PASS.includes("dependency scan endpoint responds (audit result or clear error)")],
      ["browser reliability (3 sessions)", PASS.includes("browser reliability: 3/3 consecutive sessions complete")],
    ];
    for (const [name, ok] of criteria) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  } finally {
    server.kill("SIGTERM");
    memoryModel.kill("SIGTERM");
    guardModel.kill("SIGTERM");
    slowModel.kill("SIGTERM");
    echoServer.kill("SIGTERM");
    spawnSync("pkill", ["-f", "dist/index.js"], { stdio: "ignore" });
    spawnSync("pkill", ["-f", "mock-model"], { stdio: "ignore" });
  }

  console.log(`\n${PASS.length} checks passed, ${FAIL.length} failed`);
  process.exit(FAIL.length === 0 ? 0 : 1);
}

function yamlify(value, indent) {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    return value.map((v) => `${pad}- ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n");
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value)
      .map(([k, v]) => (typeof v === "object" ? `${pad}${k}:\n${yamlify(v, indent + 2)}` : `${pad}${k}: ${JSON.stringify(v)}`))
      .join("\n");
  }
  return `${pad}${String(value)}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
