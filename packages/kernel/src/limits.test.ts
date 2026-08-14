import { describe, expect, it } from "vitest";

class FakeLimiter {
  constructor(private readonly limit: number, private readonly maxActive: (() => number) | undefined = undefined) {}
  private window = new Map<string, { count: number; resetAt: number }>();
  rateLimitOk(key: string): boolean {
    const now = Date.now();
    const entry = this.window.get(key);
    if (!entry || entry.resetAt <= now) {
      this.window.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    if (entry.count >= this.limit) return false;
    entry.count++;
    return true;
  }
  quotaOk(): boolean {
    if (!this.maxActive) return true;
    return this.maxActive() < this.limit;
  }
}

describe("rate limiting + task quota", () => {
  it("allows up to the limit per minute then rejects", () => {
    const limiter = new FakeLimiter(5);
    const results = Array.from({ length: 8 }, () => limiter.rateLimitOk("127.0.0.1"));
    expect(results.slice(0, 5)).toEqual([true, true, true, true, true]);
    expect(results.slice(5)).toEqual([false, false, false]);
  });

  it("separates counters per client", () => {
    const limiter = new FakeLimiter(2);
    limiter.rateLimitOk("a");
    limiter.rateLimitOk("a");
    expect(limiter.rateLimitOk("a")).toBe(false);
    expect(limiter.rateLimitOk("b")).toBe(true);
  });

  it("enforces the concurrent task quota", () => {
    let active = 3;
    const limiter = new FakeLimiter(2, () => active);
    expect(limiter.quotaOk()).toBe(false);
    active = 1;
    expect(limiter.quotaOk()).toBe(true);
  });
});
