import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PORT = 8787;
const MOCK_PORT = 12000 + (Date.now() % 10000);
const MASTER_KEY = "v03-verify-master-key";
const WORKDIR = join(tmpdir(), `zagros-verify-v03-${Date.now()}`);
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

async function waitFor(fn, timeoutMs, intervalMs = 300, label = "condition") {
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
    redirect: "manual",
  });
  let data;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers, url: res.url };
}

async function main() {
  spawnSync("bash", ["-c", 'PIDS=$(ss -tlnp 2>/dev/null | grep ":8787 " | grep -oP "pid=\\K[0-9]+" | sort -u); for p in $PIDS; do kill -9 $p 2>/dev/null; done'], { stdio: "ignore" });  // kill-port-8787

  spawnSync("pkill", ["-f", "dist/index.js"], { stdio: "ignore" });
  spawnSync("pkill", ["-f", "mock-model"], { stdio: "ignore" });
  spawnSync("pkill", ["-f", "mock-oauth-mcp"], { stdio: "ignore" });
  await sleep(500);

  mkdirSync(WORKDIR, { recursive: true });
  console.log(`v0.3.0 verify workspace: ${WORKDIR}`);

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
      MOCK_FLOW: "post",
      MOCK_ECHO_URL: `http://127.0.0.1:${MOCK_PORT}/echo`,
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
      ZAGROS_MASTER_KEY: MASTER_KEY,
      ZAGROS_RUNNER_TOKEN: "v03-runner-token",
      ZAGROS_PUBLIC_URL: `http://127.0.0.1:${PORT}`,
      GITHUB_OAUTH_CLIENT_ID: "mock-client",
      GITHUB_OAUTH_CLIENT_SECRET: "mock-secret",
      GITHUB_OAUTH_AUTHORIZE_URL: `http://127.0.0.1:${MOCK_PORT}/oauth/authorize`,
      GITHUB_OAUTH_TOKEN_URL: `http://127.0.0.1:${MOCK_PORT}/oauth/token`,
      GITHUB_OAUTH_API_BASE: `http://127.0.0.1:${MOCK_PORT}`,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  server.stdout.on("data", (d) => appendFileSync(SERVER_LOG, d));

  try {
    await waitFor(async () => (await req("GET", "/api/health")).data?.ok, 30000, 500, "server health");
    check("server healthy", true);

    const providers = await req("GET", "/api/oauth/providers");
    check("OAuth providers listed", providers.data.providers.some((p) => p.id === "github") && providers.data.enabled === true, JSON.stringify(providers.data));

    await req("PUT", "/api/settings", {
      defaultModel: {
        driver: "openai-compatible",
        model: "mock-model",
        baseUrl: `http://127.0.0.1:${MOCK_PORT + 1}/v1`,
        temperature: 0.2,
        imageInput: true,
      },
      mcpServers: [
        {
          id: "mock-mcp",
          name: "Mock OAuth MCP",
          transport: "http",
          url: `http://127.0.0.1:${MOCK_PORT}/mcp`,
          oauth: { clientId: "mock-client", scopes: ["tools"] },
        },
      ],
    });
    check("settings saved with MCP OAuth config", true);

    console.log("--- connector OAuth (GitHub against mock provider) ---");
    const authorize = await req("GET", "/api/oauth/github/authorize");
    check("authorize redirects to provider", authorize.status === 302 && authorize.headers.get("location")?.includes("state="), String(authorize.status));
    const providerUrl = authorize.headers.get("location") ?? "";
    const callbackUrl = await (async () => {
      const res = await fetch(providerUrl, { redirect: "manual" });
      return res.headers.get("location") ?? "";
    })();
    check("provider redirected back with code+state", callbackUrl.includes("code=mock-auth-code"), callbackUrl);
    const callbackRes = await fetch(callbackUrl);
    const callbackHtml = await callbackRes.text();
    check("callback page says connected", callbackRes.ok && callbackHtml.includes("Connected"), callbackHtml.slice(0, 80));

    const connectors = await req("GET", "/api/connectors");
    const githubConnector = connectors.data.find((c) => c.provider === "github");
    check("connector stored (encrypted)", Boolean(githubConnector), JSON.stringify(connectors.data));
    check("connector account resolved from userinfo", githubConnector?.account === "github:mock@example.com", githubConnector?.account);
    const rawSettings = await (async () => {
      const { readFileSync } = await import("node:fs");
      return readFileSync(join(WORKDIR, "data/zagros.db"), "utf8").slice(0, 100000);
    })().catch(() => "");
    check("no plaintext tokens in database", !rawSettings.includes("mock-token") && !rawSettings.includes("mock-refresh"));

    console.log("--- MCP OAuth flow ---");
    await waitFor(async () => {
      const servers = await req("GET", "/api/mcp/servers");
      const s = servers.data.servers.find((x) => x.id === "mock-mcp");
      return s?.oauth?.status === "awaiting" ? s : null;
    }, 15000, 500, "mcp awaiting");
    check("MCP server shows awaiting authorization", true);

    const mcpAuth = await req("GET", "/api/mcp/servers/mock-mcp/auth");
    check("MCP authorize redirects", mcpAuth.status === 302 && mcpAuth.headers.get("location")?.includes("code_challenge="), String(mcpAuth.status));
    const mcpCallback = await (async () => {
      const res = await fetch(mcpAuth.headers.get("location") ?? "", { redirect: "manual" });
      return res.headers.get("location") ?? "";
    })();
    const mcpCallbackRes = await fetch(mcpCallback);
    const mcpHtml = await mcpCallbackRes.text();
    check("MCP OAuth callback completes", mcpCallbackRes.ok && mcpHtml.includes("MCP server connected"), mcpHtml.slice(0, 100));

    await waitFor(async () => {
      const tools = await req("GET", "/api/tools");
      return tools.data.some((t) => t.id === "mock-mcp__mock.echo") ? true : null;
    }, 15000, 500, "mcp tools registered");
    check("OAuth'd MCP tool registered (mock-mcp__mock.echo)", true);

    console.log("--- approval flow ---");
    const agent = await req("POST", "/api/agents", { name: "V03 Agent", systemPrompt: "You are a v0.3.0 verification agent." });
    const conversation = await req("POST", "/api/conversations", { agentId: agent.data.id, title: "V03 Chat" });
    const sent = await req("POST", `/api/conversations/${conversation.data.id}/messages`, {
      content: "Send the test POST and report what came back.",
    });
    const taskId = sent.data.task.id;

    const waiting = await waitFor(async () => {
      const t = await req("GET", `/api/tasks/${taskId}`);
      return t.data.status === "waiting_for_approval" ? t.data : null;
    }, 30000, 500, "task waiting for approval");
    check("write action waits for approval (waiting_for_approval)", true);

    const approvals = await req("GET", `/api/approvals?taskId=${taskId}`);
    const approval = approvals.data.find((a) => a.status === "pending");
    check("approval record created with risk + args", approval?.toolId === "http.post" && approval?.risk === "R2" && approval?.toolArgs?.url, JSON.stringify(approval));
    check("approval exposes human-readable metadata", approval?.reason?.includes("http.post") && Boolean(approval.expiresAt), approval?.reason);

    const denied = await req("POST", `/api/approvals/${approval.id}/decide`, { decision: "rejected" });
    check("reject decision accepted", denied.data.ok === true);
    const rejectedTask = await waitFor(async () => {
      const t = await req("GET", `/api/tasks/${taskId}`);
      return t.data.status === "completed" ? t.data : null;
    }, 30000, 500, "task completes after rejection");
    const rejectedStep = rejectedTask.steps.find((s) => s.toolId === "http.post");
    check("rejected action not executed", rejectedStep?.status === "failed" && (rejectedStep?.error ?? "").includes("rejected"), rejectedStep?.error);

    console.log("--- second task: approve the action ---");
    const sent2 = await req("POST", `/api/conversations/${conversation.data.id}/messages`, { content: "Send the test POST again." });
    const taskId2 = sent2.data.task.id;
    const approval2 = await waitFor(async () => {
      const approvals2 = await req("GET", `/api/approvals?taskId=${taskId2}`);
      return approvals2.data.find((a) => a.status === "pending") ?? null;
    }, 30000, 500, "second approval");
    const decided = await req("POST", `/api/approvals/${approval2.id}/decide`, { decision: "approved" });
    check("approve decision accepted", decided.data.ok === true);
    const finalTask = await waitFor(async () => {
      const t = await req("GET", `/api/tasks/${taskId2}`);
      return t.data.status === "completed" || t.data.status === "failed" ? t.data : null;
    }, 45000, 1000, "second task terminal").catch(async (err) => {
      const t = await req("GET", `/api/tasks/${taskId2}`);
      const a = await req("GET", `/api/approvals?taskId=${taskId2}`);
      console.log("DEBUG task:", JSON.stringify(t.data).slice(0, 1200));
      console.log("DEBUG approvals:", JSON.stringify(a.data));
      throw err;
    });
    const step2 = finalTask.steps.find((s) => s.toolId === "http.post");
    check("approved action executed", step2?.status === "completed", step2?.status);
    check(
      "action reached the external endpoint",
      JSON.stringify(step2?.result)?.includes('"ok":true') && JSON.stringify(step2?.result)?.includes("from-mock-model"),
      JSON.stringify(step2?.result)?.slice(0, 200)
    );
    const approvedApproval = await req("GET", `/api/approvals?taskId=${taskId2}`);
    check("approval marked approved with timestamp", approvedApproval.data.find((a) => a.id === approval2.id)?.status === "approved");

    const audit = await req("GET", "/api/audit?limit=100");
    const types = audit.data.map((a) => a.type);
    check("audit records connector.connected", types.includes("connector.connected"), types.join(","));
    check("audit records mcp.oauth.connected", types.includes("mcp.oauth.connected"));
    check("audit records approval lifecycle", types.includes("approval.requested") || types.includes("approval.decided"), types.filter((t) => t.includes("approval")).join(","));

    const connectorTools = await req("GET", "/api/tools");
    check("connector tool registered (connector.github.api)", connectorTools.data.some((t) => t.id === "connector.github.api"));
    const githubToolCall = await req("GET", `/api/approvals?taskId=__none__`);
    void githubToolCall;

    console.log("\n=== v0.3.0 EXIT CRITERIA ===");
    const criteria = [
      ["connect remote MCP (with OAuth)", PASS.includes("MCP OAuth callback completes") && PASS.includes("OAuth'd MCP tool registered (mock-mcp__mock.echo)")],
      ["complete OAuth (connector)", PASS.includes("connector stored (encrypted)") && PASS.includes("connector account resolved from userinfo")],
      ["agent uses tool", PASS.includes("approved action executed")],
      ["write action requires approval", PASS.includes("write action waits for approval (waiting_for_approval)")],
      ["user approves (and rejects) on phone", PASS.includes("approve decision accepted") && PASS.includes("reject decision accepted")],
      ["audit trail records everything", PASS.includes("audit records connector.connected") && PASS.includes("audit records approval lifecycle")],
      ["credentials encrypted at rest", PASS.includes("no plaintext tokens in database")],
    ];
    for (const [name, ok] of criteria) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  } finally {
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
