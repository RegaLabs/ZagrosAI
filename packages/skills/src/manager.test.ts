import { describe, it, expect } from "vitest";
import { FsSkillSource, SkillManager, type SkillSource } from "./manager.js";

class MemorySkillSource implements SkillSource {
  constructor(private readonly files: Map<string, string>) {}

  async listSkillNames(): Promise<string[]> {
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      const parts = key.split("/");
      if (parts.length >= 2) names.add(parts[0]!);
    }
    return [...names];
  }

  async readSkillFile(name: string, relativePath: string): Promise<string | undefined> {
    return this.files.get(`${name}/${relativePath}`);
  }

  skillDir(name: string): string | undefined {
    return `/tmp/skills/${name}`;
  }
}

describe("SkillManager", () => {
  it("loads a skill with skill.yaml", async () => {
    const files = new Map<string, string>([
      [
        "code-review/skill.yaml",
        "name: code-review\ndescription: Automated code reviewer\ntags: [code, review]\n",
      ],
      ["code-review/SKILL.md", "# Code Reviewer\nReview PRs carefully."],
    ]);
    const manager = new SkillManager(new MemorySkillSource(files));
    const skill = await manager.get("code-review");
    expect(skill?.name).toBe("code-review");
    expect(skill?.description).toBe("Automated code reviewer");
    expect(skill?.readme).toContain("Review PRs");
  });

  it("loads a skill using SKILL.md frontmatter fallback", async () => {
    const files = new Map<string, string>([
      [
        "doc-gen/SKILL.md",
        "---\nname: doc-gen\ndescription: Documentation generator\n---\n# Doc Gen\nGenerates docs.",
      ],
    ]);
    const manager = new SkillManager(new MemorySkillSource(files));
    const skill = await manager.get("doc-gen");
    expect(skill?.name).toBe("doc-gen");
    expect(skill?.description).toBe("Documentation generator");
    expect(skill?.readme).toBe("# Doc Gen\nGenerates docs.");
  });

  it("discovers skills matching query terms", async () => {
    const files = new Map<string, string>([
      [
        "web-scraper/skill.yaml",
        "name: web-scraper\ndescription: Scrape web pages and extract structured data\ntags: [web, scraper, html]\n",
      ],
      ["web-scraper/SKILL.md", "# Web Scraper\nExtracts text and table content from URLs."],
    ]);
    const manager = new SkillManager(new MemorySkillSource(files));
    const matches = await manager.discover("Please scrape web pages for data");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.name).toBe("web-scraper");
  });
});
