import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { McpStdioClient } from "./stdio.js";

const mockServerPath = fileURLToPath(new URL("../test/mock-server.mjs", import.meta.url));

describe("McpStdioClient", () => {
  let client: McpStdioClient;

  beforeAll(async () => {
    client = new McpStdioClient({ command: "node", args: [mockServerPath] });
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
  });

  it("connects and lists one tool with the right schema", async () => {
    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("mock.echo");
    expect(tools[0]?.description).toBe("Echo text");
    expect(tools[0]?.inputSchema).toEqual({
      type: "object",
      properties: { text: { type: "string" } },
    });
  });

  it("calls mock.echo and returns echoed text", async () => {
    const result = await client.callTool("mock.echo", { text: "hi" });
    expect(result.ok).toBe(true);
    expect(result.text).toContain("echo:hi");
  });

  it("reports errors for unknown tools", async () => {
    const result = await client.callTool("unknown.tool", {});
    expect(result.ok).toBe(false);
  });

  it("handles request timeouts properly", async () => {
    const shortTimeoutClient = new McpStdioClient({
      command: "node",
      args: ["-e", "setInterval(() => {}, 1000)"], // Unresponsive process
      connectTimeoutMs: 200,
      timeoutMs: 200,
    });

    await expect(shortTimeoutClient.connect()).rejects.toThrow(/timed out/);
    await shortTimeoutClient.close();
  });

  it("auto-reconnects if the server process terminates unexpectedly", async () => {
    const restartableClient = new McpStdioClient({
      command: "node",
      args: [mockServerPath],
    });
    await restartableClient.connect();

    const result1 = await restartableClient.callTool("mock.echo", { text: "first" });
    expect(result1.ok).toBe(true);

    // Simulate process termination
    const child = (restartableClient as unknown as { child?: { kill: () => void } }).child;
    child?.kill();

    // Give process a moment to exit
    await new Promise((r) => setTimeout(r, 100));

    // Next call should automatically reconnect and succeed
    const result2 = await restartableClient.callTool("mock.echo", { text: "second" });
    expect(result2.ok).toBe(true);
    expect(result2.text).toContain("echo:second");

    await restartableClient.close();
  });
});
