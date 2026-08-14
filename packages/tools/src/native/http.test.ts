import { describe, it, expect, vi } from "vitest";
import { createHttpTools } from "./http.js";

describe("createHttpTools", () => {
  it("enforces domain policy on fetch and post", async () => {
    const policy = (url: string) => {
      if (url.includes("internal.local")) return "Access to internal.local is forbidden";
      return undefined;
    };
    const tools = createHttpTools(policy);
    const fetchTool = tools[0]!;
    const postTool = tools[1]!;

    const fetchRes = await fetchTool.execute({ url: "https://internal.local/secret" }, {});
    expect(fetchRes.ok).toBe(false);
    expect(fetchRes.error).toContain("forbidden");

    const postRes = await postTool.execute({ url: "https://internal.local/api", body: { test: 1 } }, {});
    expect(postRes.ok).toBe(false);
    expect(postRes.error).toContain("forbidden");
  });
});
