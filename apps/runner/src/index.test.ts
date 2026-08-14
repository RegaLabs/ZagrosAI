import { describe, it, expect } from "vitest";
import { parseArgs, detectHarnesses } from "./index.js";

describe("runner CLI argument parsing & validation", () => {
  it("parses valid CLI arguments with ws:// URL", () => {
    const opts = parseArgs([
      "start",
      "--url",
      "ws://127.0.0.1:8787/ws/runner",
      "--token",
      "secret-token-123",
      "--name",
      "test-worker",
      "--workspace",
      "/tmp/custom-workspace",
      "--no-browser",
    ]);

    expect(opts).toBeDefined();
    expect(opts?.url).toBe("ws://127.0.0.1:8787/ws/runner");
    expect(opts?.token).toBe("secret-token-123");
    expect(opts?.name).toBe("test-worker");
    expect(opts?.workspace).toBe("/tmp/custom-workspace");
    expect(opts?.noBrowser).toBe(true);
  });

  it("parses valid CLI arguments with wss:// URL", () => {
    const opts = parseArgs([
      "start",
      "--url",
      "wss://zagros.example.com/ws/runner",
      "--token",
      "secure-token",
    ]);

    expect(opts).toBeDefined();
    expect(opts?.url).toBe("wss://zagros.example.com/ws/runner");
    expect(opts?.token).toBe("secure-token");
    expect(opts?.noBrowser).toBe(false);
  });

  it("rejects non-WebSocket URLs", () => {
    const httpOpts = parseArgs([
      "start",
      "--url",
      "http://127.0.0.1:8787/ws/runner",
      "--token",
      "secret-token-123",
    ]);
    expect(httpOpts).toBeUndefined();

    const ftpOpts = parseArgs([
      "start",
      "--url",
      "ftp://127.0.0.1/ws/runner",
      "--token",
      "secret-token-123",
    ]);
    expect(ftpOpts).toBeUndefined();

    const invalidUrl = parseArgs([
      "start",
      "--url",
      "not-a-valid-url",
      "--token",
      "secret-token-123",
    ]);
    expect(invalidUrl).toBeUndefined();
  });

  it("rejects missing start subcommand", () => {
    const opts = parseArgs([
      "--url",
      "ws://127.0.0.1:8787/ws/runner",
      "--token",
      "secret",
    ]);
    expect(opts).toBeUndefined();
  });

  it("rejects missing required flags (url or token)", () => {
    const missingToken = parseArgs(["start", "--url", "ws://127.0.0.1:8787/ws/runner"]);
    expect(missingToken).toBeUndefined();

    const missingUrl = parseArgs(["start", "--token", "my-secret"]);
    expect(missingUrl).toBeUndefined();

    const emptyToken = parseArgs(["start", "--url", "ws://127.0.0.1:8787/ws/runner", "--token", "   "]);
    expect(emptyToken).toBeUndefined();
  });

  it("trims whitespace from arguments", () => {
    const opts = parseArgs([
      "start",
      "--url",
      "  ws://127.0.0.1:8787/ws/runner  ",
      "--token",
      "  my-token  ",
      "--name",
      "  my-worker  ",
    ]);
    expect(opts).toBeDefined();
    expect(opts?.url).toBe("ws://127.0.0.1:8787/ws/runner");
    expect(opts?.token).toBe("my-token");
    expect(opts?.name).toBe("my-worker");
  });
});

describe("detectHarnesses configuration", () => {
  it("detects harnesses configured via environment variables", async () => {
    const env: NodeJS.ProcessEnv = {
      ZAGROS_HARNESS_CMD_CUSTOM: "custom-cli,arg1,arg2",
    };
    const harnesses = await detectHarnesses(env);
    const custom = harnesses.find((h) => h.name === "custom");
    expect(custom).toBeDefined();
    expect(custom?.command).toBe("custom-cli");
    expect(custom?.args).toEqual(["arg1", "arg2"]);
  });
});
