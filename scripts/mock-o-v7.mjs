import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_OAUTH_PORT ?? 9899);
const BASE = `http://127.0.0.1:${PORT}`;

const MCP_ORIGIN = process.env.MOCK_MCP_ORIGIN ?? `http://127.0.0.1:${PORT}`;

function json(res, body, status = 200) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(raw));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, BASE);

  if (url.pathname === "/page") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(
      "<!doctype html><html><head><title>Zagros Test Page</title></head><body>" +
        "<h1 id=\"heading\">Zagros test page</h1>" +
        "<p id=\"status\">ready</p>" +
        "<input id=\"name\" placeholder=\"name\"><button id=\"go\">Submit</button>" +
        "<script>document.getElementById('go').addEventListener('click',function(){document.getElementById('status').textContent='submitted:'+document.getElementById('name').value;});</script>" +
        "</body></html>"
    );
    return;
  }

  if (url.pathname === "/secret") {
    json(res, { token: "SCRUBME-TOKEN-42" });
    return;
  }

  if (url.pathname === "/echo" && req.method === "POST") {
    const body = await readBody(req);
    json(res, { ok: true, received: JSON.parse(body || "{}") });
    return;
  }

  if (url.pathname === "/.well-known/oauth-authorization-server") {
    json(res, {
      issuer: BASE,
      authorization_endpoint: `${BASE}/oauth/authorize`,
      token_endpoint: `${BASE}/oauth/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
    });
    return;
  }

  if (url.pathname === "/.well-known/oauth-protected-resource") {
    json(res, { authorization_servers: [`${BASE}/.well-known/oauth-authorization-server`] });
    return;
  }

  if (url.pathname === "/oauth/authorize") {
    const redirect = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    const challenge = url.searchParams.get("code_challenge");
    if (!redirect || !state) {
      json(res, { error: "missing_redirect_or_state" }, 400);
      return;
    }
    const sep = redirect.includes("?") ? "&" : "?";
    res.writeHead(302, { location: `${redirect}${sep}code=mock-auth-code&state=${encodeURIComponent(state)}${challenge ? `&code_challenge=${challenge}` : ""}` });
    res.end();
    return;
  }

  if (url.pathname === "/oauth/token" && req.method === "POST") {
    const body = new URLSearchParams(await readBody(req));
    const grant = body.get("grant_type") ?? (body.get("code") ? "authorization_code" : undefined);
    if (grant === "refresh_token") {
      json(res, { access_token: "mock-token-refreshed", refresh_token: "mock-refresh", expires_in: 3600, scope: body.get("scope") ?? "", token_type: "Bearer" });
      return;
    }
    if (grant === "authorization_code") {
      json(res, { access_token: "mock-token", refresh_token: "mock-refresh", expires_in: 3600, scope: body.get("scope") ?? "", token_type: "Bearer" });
      return;
    }
    json(res, { error: "unsupported_grant_type" }, 400);
    return;
  }

  if (url.pathname === "/userinfo") {
    json(res, { email: "mock@example.com", name: "Mock User", sub: "mock-user-1" });
    return;
  }

  if (url.pathname === "/user") {
    json(res, { login: "mockuser", id: 42, name: "Mock User", email: "mock@example.com" });
    return;
  }

  if (url.pathname === "/mcp" && req.method === "POST") {
    const token = req.headers.authorization;
    if (!token || token !== "Bearer mock-token") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "unauthorized" }, id: null }));
      return;
    }
    const body = JSON.parse(await readBody(req));
    if (body.method === "initialize") {
      json(res, {
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "mock-mcp-oauth", version: "1.0" },
        },
      });
      return;
    }
    if (body.method === "notifications/initialized") {
      res.writeHead(202);
      res.end();
      return;
    }
    if (body.method === "tools/list") {
      json(res, {
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: [{ name: "mock.echo", description: "Echo text back", inputSchema: { type: "object", properties: { text: { type: "string" } } } }],
        },
      });
      return;
    }
    if (body.method === "tools/call") {
      const text = body.params?.arguments?.text ?? "";
      json(res, {
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: `mcp-echo:${text}` }], isError: false },
      });
      return;
    }
    json(res, { jsonrpc: "2.0", error: { code: -32601, message: "method not found" }, id: body.id });
    return;
  }

  if (url.pathname === "/health") {
    json(res, { ok: true });
    return;
  }

  json(res, { error: "not_found" }, 404);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock oauth+mcp listening on http://127.0.0.1:${PORT} (mcp origin ${MCP_ORIGIN})`);
});
