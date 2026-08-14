import { describe, it, expect } from "vitest";
import { defaultSettings, agentSchema, modelConfigSchema, skillManifestSchema, newId } from "./index.js";

describe("domain schemas", () => {
  it("parses defaultSettings correctly", () => {
    const settings = defaultSettings();
    expect(settings.defaultModel.driver).toBe("ollama");
    expect(settings.defaultModel.imageInput).toBe(true);
  });

  it("validates agentSchema", () => {
    const agent = agentSchema.parse({
      id: "agent_123456789012",
      name: "Test Agent",
      systemPrompt: "Helpful agent",
      model: {
        driver: "openai",
        model: "gpt-4o",
      },
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
    });
    expect(agent.name).toBe("Test Agent");
    expect(agent.model.driver).toBe("openai");
  });

  it("handles empty baseUrl in modelConfigSchema", () => {
    const config = modelConfigSchema.parse({
      driver: "openai",
      model: "gpt-4o",
      baseUrl: "",
    });
    expect(config.baseUrl).toBe("");
  });

  it("parses skillManifestSchema with null optional blocks", () => {
    const manifest = skillManifestSchema.parse({
      name: "my-skill",
      description: "A test skill",
      requires: null,
      approval: null,
      permissions: null,
    });
    expect(manifest.name).toBe("my-skill");
    expect(manifest.requires.tools).toEqual([]);
    expect(manifest.permissions.secrets).toBe(false);
  });

  it("generates 128-bit UUID ids with prefix", () => {
    const id = newId("task");
    expect(id).toMatch(/^task_[0-9a-f]{32}$/);
  });
});


