import { describe, it, expect } from "vitest";
import { AuditChainer, verifyAuditChain } from "./audit-chain.js";
import type { AuditEvent } from "@zagros/domain";
import type { Repos } from "@zagros/runtime";

function createMockRepos(): Repos {
  const auditEvents: AuditEvent[] = [];
  return {
    appendAudit: async (event: AuditEvent) => {
      auditEvents.unshift(event); // newest first
    },
    listAudit: async (limit?: number) => {
      return limit ? auditEvents.slice(0, limit) : [...auditEvents];
    },
  } as unknown as Repos;
}

describe("AuditChainer and verifyAuditChain", () => {
  it("chains audit events with SHA-256 hashes", async () => {
    const repos = createMockRepos();
    const chainer = new AuditChainer(repos);

    await chainer.appendAudit({
      id: "audit-1",
      type: "connector.connected",
      detail: { provider: "github", account: "github:alice" },
      createdAt: "2026-08-14T10:00:00.000Z",
    });

    await chainer.appendAudit({
      id: "audit-2",
      type: "mcp.oauth.connected",
      detail: { serverId: "test-mcp" },
      createdAt: "2026-08-14T10:01:00.000Z",
    });

    await chainer.appendAudit({
      id: "audit-3",
      type: "approval.decided",
      detail: { approvalId: "app-1", decision: "approved" },
      createdAt: "2026-08-14T10:02:00.000Z",
    });

    const events = await repos.listAudit();
    expect(events.length).toBe(3);

    // Event 1 (oldest, last in events list)
    const e1 = events[2]!;
    const d1 = e1.detail as Record<string, unknown>;
    expect(d1.__prevHash).toBeNull();
    expect(typeof d1.__hash).toBe("string");
    expect((d1.__hash as string).length).toBe(64);

    // Event 2
    const e2 = events[1]!;
    const d2 = e2.detail as Record<string, unknown>;
    expect(d2.__prevHash).toBe(d1.__hash);
    expect(typeof d2.__hash).toBe("string");

    // Event 3 (newest, first in events list)
    const e3 = events[0]!;
    const d3 = e3.detail as Record<string, unknown>;
    expect(d3.__prevHash).toBe(d2.__hash);
    expect(typeof d3.__hash).toBe("string");

    const result = await verifyAuditChain(events);
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeUndefined();
  });

  it("scrubs secrets before computing hashes", async () => {
    const repos = createMockRepos();
    const chainer = new AuditChainer(repos);

    await chainer.appendAudit({
      id: "audit-secret",
      type: "connector.connected",
      detail: {
        provider: "github",
        access_token: "ghp_123456789012345678901234567890123456",
        client_secret: "supersecret12345",
      },
      createdAt: "2026-08-14T10:00:00.000Z",
    });

    const events = await repos.listAudit();
    const detail = events[0]!.detail as Record<string, unknown>;
    expect(detail.access_token).toBe("ghp_...3456");
    expect(detail.client_secret).toBe("supe...2345");

    const result = await verifyAuditChain(events);
    expect(result.valid).toBe(true);
  });

  it("detects tampered event details in the chain", async () => {
    const repos = createMockRepos();
    const chainer = new AuditChainer(repos);

    await chainer.appendAudit({
      id: "audit-1",
      type: "connector.connected",
      detail: { provider: "github", account: "github:alice" },
      createdAt: "2026-08-14T10:00:00.000Z",
    });

    await chainer.appendAudit({
      id: "audit-2",
      type: "approval.decided",
      detail: { approvalId: "app-1", decision: "approved" },
      createdAt: "2026-08-14T10:01:00.000Z",
    });

    const events = await repos.listAudit();

    // Tamper with event 1's detail
    (events[1]!.detail as Record<string, unknown>).account = "github:attacker";

    const result = await verifyAuditChain(events);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe("audit-1");
  });

  it("detects deleted events or broken links in the chain", async () => {
    const repos = createMockRepos();
    const chainer = new AuditChainer(repos);

    await chainer.appendAudit({
      id: "audit-1",
      type: "event-1",
      detail: {},
      createdAt: "2026-08-14T10:00:00.000Z",
    });

    await chainer.appendAudit({
      id: "audit-2",
      type: "event-2",
      detail: {},
      createdAt: "2026-08-14T10:01:00.000Z",
    });

    await chainer.appendAudit({
      id: "audit-3",
      type: "event-3",
      detail: {},
      createdAt: "2026-08-14T10:02:00.000Z",
    });

    const events = await repos.listAudit();
    // Drop event 2 from the middle: events now [audit-3, audit-1]
    const tamperedList = [events[0]!, events[2]!];

    const result = await verifyAuditChain(tamperedList);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe("audit-3");
  });

  it("detects tampered event type or timestamp", async () => {
    const repos = createMockRepos();
    const chainer = new AuditChainer(repos);

    await chainer.appendAudit({
      id: "audit-1",
      type: "task.created",
      detail: { taskId: "t-1" },
      createdAt: "2026-08-14T10:00:00.000Z",
    });

    const events = await repos.listAudit();
    events[0]!.createdAt = "2026-08-14T10:00:01.000Z"; // Tamper with timestamp

    const result = await verifyAuditChain(events);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe("audit-1");
  });
});
