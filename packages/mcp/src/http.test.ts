import { describe, expect, it, vi } from "vitest";
import { McpHttpClient, discoverMcpOAuth } from "./http.js";

describe("McpHttpClient (JSON-RPC 2.0 & SSE)", () => {
  it("connects, lists tools, and calls tool via standard JSON-RPC 2.0", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async (url, init) => {
      callCount++;
      const body = JSON.parse(init.body);

      if (body.method === "initialize") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              serverInfo: { name: "test-mcp-server", version: "1.0.0" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (body.method === "notifications/initialized") {
        return new Response(null, { status: 204 });
      }

      if (body.method === "tools/list") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                {
                  name: "search_db",
                  description: "Search internal database",
                  inputSchema: { type: "object", properties: { query: { type: "string" } } },
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (body.method === "tools/call") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{ type: "text", text: `results for: ${body.params.arguments.query}` }],
              isError: false,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", mockFetch);

    const client = new McpHttpClient({ url: "https://mcp.zagros.ai/rpc" });
    await client.connect();

    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("search_db");

    const callResult = await client.callTool("search_db", { query: "audit logs" });
    expect(callResult.ok).toBe(true);
    expect(callResult.text).toBe("results for: audit logs");

    await client.close();
  });

  it("handles SSE (text/event-stream) streaming responses", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.method === "initialize") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              serverInfo: { name: "sse-server", version: "1.0" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (body.method === "notifications/initialized") {
        return new Response(null, { status: 204 });
      }

      if (body.method === "tools/call") {
        const sseBody = [
          ": comment line",
          `event: message`,
          `data: ${JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{ type: "text", text: "streamed tool response" }],
            },
          })}`,
          "",
          "data: [DONE]",
          "",
        ].join("\n");

        return new Response(sseBody, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }

      return new Response(null, { status: 404 });
    });

    vi.stubGlobal("fetch", mockFetch);

    const client = new McpHttpClient({ url: "https://mcp.zagros.ai/sse" });
    await client.connect();

    const result = await client.callTool("stream_tool", {});
    expect(result.ok).toBe(true);
    expect(result.text).toBe("streamed tool response");
  });

  it("automatically refreshes token on 401/403 and retries request", async () => {
    let refreshCalls = 0;
    let authHeaderSeen = "";

    const tokenRefresher = vi.fn().mockImplementation(async () => {
      refreshCalls++;
      return "fresh-mcp-bearer-token-999";
    });

    const mockFetch = vi.fn().mockImplementation(async (url, init) => {
      authHeaderSeen = init.headers.authorization;
      const body = JSON.parse(init.body);

      if (authHeaderSeen === "Bearer expired-token") {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            serverInfo: { name: "oauth-server", version: "1.0" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    vi.stubGlobal("fetch", mockFetch);

    const client = new McpHttpClient({
      url: "https://mcp.zagros.ai/oauth-mcp",
      token: "expired-token",
      tokenRefresher,
    });

    await client.connect();
    expect(tokenRefresher).toHaveBeenCalledTimes(1);
    expect(authHeaderSeen).toBe("Bearer fresh-mcp-bearer-token-999");
  });

  it("extracts and formats JSON-RPC 2.0 error codes and data", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.method === "initialize") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              serverInfo: { name: "test", version: "1.0" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: {
            code: -32602,
            message: "Invalid params",
            data: { details: "Field 'name' is required" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    vi.stubGlobal("fetch", mockFetch);

    const client = new McpHttpClient({ url: "https://mcp.zagros.ai/rpc" });
    await client.connect();

    await expect(client.listTools()).rejects.toThrow(
      /\[code -32602\] Invalid params \(data: \{"details":"Field 'name' is required"\}\)/
    );
  });
});

describe("discoverMcpOAuth", () => {
  it("discovers OAuth authorization and token endpoints from well-known metadata", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(".well-known/oauth-protected-resource")) {
        return new Response(
          JSON.stringify({
            authorization_servers: ["https://auth.zagros.ai"],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes(".well-known/oauth-authorization-server")) {
        return new Response(
          JSON.stringify({
            authorization_endpoint: "https://auth.zagros.ai/oauth/authorize",
            token_endpoint: "https://auth.zagros.ai/oauth/token",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(null, { status: 404 });
    });

    vi.stubGlobal("fetch", mockFetch);

    const discovery = await discoverMcpOAuth("https://mcp.zagros.ai/server");
    expect(discovery.authorizationEndpoint).toBe("https://auth.zagros.ai/oauth/authorize");
    expect(discovery.tokenEndpoint).toBe("https://auth.zagros.ai/oauth/token");
    expect(discovery.resourceServer).toBe("https://mcp.zagros.ai/server");
  });
});
