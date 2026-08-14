import { describe, expect, it, vi } from "vitest";
import { FallbackDriver } from "./fallback.js";
import { FakeModelDriver } from "./drivers/fake.js";
import { ModelDriverError } from "./types.js";

describe("FallbackChaining", () => {
  it("uses primary driver when it succeeds", async () => {
    const primary = new FakeModelDriver({ driver: "primary", model: "m1" }, [{ reply: "primary output" }]);
    const secondary = new FakeModelDriver({ driver: "secondary", model: "m2" }, [{ reply: "fallback output" }]);

    const fallbackDriver = new FallbackDriver([primary, secondary]);
    const res = await fallbackDriver.generate({ messages: [{ role: "user", content: "hello" }] });

    expect(res.text).toBe("primary output");
  });

  it("falls back to secondary driver on retryable error", async () => {
    const primary = new FakeModelDriver({ driver: "primary", model: "m1" });
    vi.spyOn(primary, "generate").mockRejectedValue(new ModelDriverError("Rate limit", "primary", 429));

    const secondary = new FakeModelDriver({ driver: "secondary", model: "m2" }, [{ reply: "fallback output" }]);

    const fallbackEvents: any[] = [];
    const fallbackDriver = new FallbackDriver([primary, secondary], {
      onFallback: (ev) => fallbackEvents.push(ev),
    });

    const res = await fallbackDriver.generate({ messages: [{ role: "user", content: "hello" }] });

    expect(res.text).toBe("fallback output");
    expect(fallbackEvents).toHaveLength(1);
    expect(fallbackEvents[0].failedDriverId).toBe("primary");
    expect(fallbackEvents[0].nextDriverId).toBe("secondary");
  });
});
