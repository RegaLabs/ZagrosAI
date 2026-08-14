import { readdir, readFile, mkdir, rm, cp, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";
import type { webcrypto } from "node:crypto";
import { skillManifestSchema, type SkillManifest, type SkillSummary } from "@zagros/domain";

type CryptoKey = webcrypto.CryptoKey;

const execFileAsync = promisify(execFile);

export interface SkillSource {
  listSkillNames(): Promise<string[]>;
  readSkillFile(name: string, relativePath: string): Promise<string | undefined>;
  skillDir(name: string): string | undefined;
}

export class FsSkillSource implements SkillSource {
  constructor(readonly dir: string) {}

  async listSkillNames(): Promise<string[]> {
    const entries = await readdir(this.dir, { withFileTypes: true }).catch(() => []);
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      const yaml =
        (await this.readSkillFile(entry.name, "skill.yaml").catch(() => undefined)) ??
        (await this.readSkillFile(entry.name, "skill.yml").catch(() => undefined));
      if (yaml !== undefined) {
        names.push(entry.name);
        continue;
      }
      const readme = await this.readSkillFile(entry.name, "SKILL.md").catch(() => undefined);
      if (readme !== undefined) {
        names.push(entry.name);
      }
    }
    return names;
  }

  async readSkillFile(name: string, relativePath: string): Promise<string | undefined> {
    return readFile(join(this.dir, name, relativePath), "utf-8").catch(() => undefined);
  }

  skillDir(name: string): string | undefined {
    return join(this.dir, name);
  }
}

export class EmptySkillSource implements SkillSource {
  async listSkillNames(): Promise<string[]> {
    return [];
  }

  async readSkillFile(): Promise<string | undefined> {
    return undefined;
  }

  skillDir(): string | undefined {
    return undefined;
  }
}

export interface LoadedSkill extends SkillSummary {
  readme: string;
  manifestYaml: string;
}

export interface SkillVerifier {
  verify(manifestYaml: string): Promise<boolean>;
  enabled: boolean;
}

function derToRawEcdsa(der: Uint8Array): Uint8Array | undefined {
  try {
    const readInteger = (start: number): { value: Uint8Array; next: number } | undefined => {
      if (der[start] !== 0x02) return undefined;
      const len = der[start + 1];
      if (len === undefined) return undefined;
      let value = der.slice(start + 2, start + 2 + len);
      if (value[0] === 0 && value.length > 32) value = value.slice(1);
      if (value.length < 32) value = new Uint8Array([...new Uint8Array(32 - value.length), ...value]);
      return { value, next: start + 2 + len };
    };
    if (der[0] !== 0x30) return undefined;
    const r = readInteger(2);
    if (!r) return undefined;
    const s = readInteger(r.next);
    if (!s) return undefined;
    return new Uint8Array([...r.value, ...s.value]);
  } catch {
    return undefined;
  }
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class EcdsaSkillVerifier implements SkillVerifier {
  readonly enabled = true;
  private readonly keyPromise: Promise<CryptoKey>;

  constructor(publicKeyPem: string) {
    const body = publicKeyPem
      .replace(/-----BEGIN PUBLIC KEY-----/, "")
      .replace(/-----END PUBLIC KEY-----/, "")
      .replace(/\s+/g, "");
    this.keyPromise = crypto.subtle.importKey(
      "spki",
      b64ToBytes(body).buffer as ArrayBuffer,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
  }

  async verify(manifestYaml: string): Promise<boolean> {
    try {
      const raw = parseYaml(manifestYaml) as Record<string, unknown> | null;
      if (!raw || typeof raw !== "object") return false;
      const signature = raw.signature as { algorithm?: string; value?: string } | undefined;
      if (!signature || signature.algorithm !== "ECDSA-P256" || typeof signature.value !== "string") return false;
      const rest = { ...raw };
      delete rest.signature;
      const canonical = JSON.stringify(rest);
      const key = await this.keyPromise;
      const signatureBytes = b64ToBytes(signature.value);
      const rawSignature = derToRawEcdsa(signatureBytes) ?? signatureBytes;
      return crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        rawSignature.buffer as ArrayBuffer,
        new TextEncoder().encode(canonical)
      );
    } catch {
      return false;
    }
  }
}

export interface SkillMatch {
  name: string;
  description: string;
  content: string;
  score: number;
}

function parseManifest(yamlText: string): SkillManifest {
  const parsed = parseYaml(yamlText);
  return skillManifestSchema.parse(parsed);
}

export class SkillManager {
  private cache: Map<string, LoadedSkill> | undefined;

  constructor(
    private readonly source: SkillSource,
    private readonly verifier?: SkillVerifier
  ) {}

  private async loadAll(): Promise<Map<string, LoadedSkill>> {
    if (this.cache) return this.cache;
    const map = new Map<string, LoadedSkill>();
    for (const name of await this.source.listSkillNames()) {
      const loaded = await this.load(name);
      if (loaded) map.set(name, loaded);
    }
    this.cache = map;
    return map;
  }

  async refresh(): Promise<SkillSummary[]> {
    this.cache = undefined;
    return this.list();
  }

  async load(name: string): Promise<LoadedSkill | undefined> {
    let manifestText =
      (await this.source.readSkillFile(name, "skill.yaml")) ??
      (await this.source.readSkillFile(name, "skill.yml"));
    let readme = (await this.source.readSkillFile(name, "SKILL.md")) ?? "";
    if (!manifestText && readme) {
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(readme.trimStart());
      if (match) {
        manifestText = match[1];
        readme = match[2] ?? "";
      }
    }
    if (!manifestText) return undefined;
    let manifest: SkillManifest;
    try {
      manifest = parseManifest(manifestText);
    } catch {
      return undefined;
    }
    const trusted = this.verifier ? await this.verifier.verify(manifestText) : true;
    return {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      requires: manifest.requires,
      approval: manifest.approval,
      verification: manifest.verification,
      tests: manifest.tests,
      permissions: manifest.permissions,
      tags: manifest.tags,
      source: name,
      trusted,
      readme,
      manifestYaml: manifestText,
    };
  }

  async list(): Promise<SkillSummary[]> {
    const map = await this.loadAll();
    return [...map.values()].map(({ readme: _readme, ...summary }) => summary);
  }

  async get(name: string): Promise<LoadedSkill | undefined> {
    const map = await this.loadAll();
    return map.get(name);
  }

  async discover(text: string): Promise<SkillMatch[]> {
    const map = await this.loadAll();
    const query = tokenize(text);
    if (query.size === 0) return [];
    const scored: SkillMatch[] = [];
    for (const skill of map.values()) {
      if (!skill.trusted) continue;
      const haystack = tokenize(`${skill.name} ${skill.description} ${skill.tags.join(" ")} ${skill.readme.slice(0, 1500)}`);
      const score = overlap(query, haystack);
      if (score > 0) {
        scored.push({
          name: skill.name,
          description: skill.description,
          content: skill.readme,
          score,
        });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 3);
  }

  async install(source: string): Promise<LoadedSkill> {
    const target = resolveInstallTarget(source);
    const tmpDir = join((this.source as FsSkillSource).dir, ".install-tmp");
    await mkdir(tmpDir, { recursive: true });
    const cloneDir = join(tmpDir, "repo");
    await rm(cloneDir, { recursive: true, force: true });
    await execFileAsync("git", ["clone", "--depth", "1", target, cloneDir]);
    const manifestText = await readFile(join(cloneDir, "skill.yaml"), "utf-8").catch(() => undefined);
    const manifest = manifestText ? parseManifest(manifestText) : undefined;
    const name = manifest?.name ?? "installed-skill";
    const dest = join((this.source as FsSkillSource).dir, name);
    await rm(dest, { recursive: true, force: true });
    await cp(cloneDir, dest, { recursive: true });
    await rm(tmpDir, { recursive: true, force: true });
    this.cache = undefined;
    const loaded = await this.load(name);
    if (!loaded) throw new Error("Installed skill is invalid (missing or malformed skill.yaml)");
    return loaded;
  }

  async remove(name: string): Promise<boolean> {
    const source = this.source as FsSkillSource;
    if (!source.skillDir) return false;
    const dir = source.skillDir(name);
    if (!dir) return false;
    await rm(dir, { recursive: true, force: true });
    this.cache = undefined;
    return true;
  }

  async skillDir(name: string): Promise<string | undefined> {
    return this.source.skillDir(name);
  }

  async runTests(name: string, execute: (command: string) => Promise<{ ok: boolean; error?: string; output?: unknown }>): Promise<Array<{ test: string; ok: boolean; output: string; error?: string }>> {
    const skill = await this.get(name);
    const dir = await this.skillDir(name);
    if (!skill || !dir) throw new Error(`Skill not found: ${name}`);
    if (skill.tests.length === 0) return [];
    const results: Array<{ test: string; ok: boolean; output: string; error?: string }> = [];
    for (const test of skill.tests) {
      const result = await execute(`cd "${dir}" && ${test}`);
      results.push({
        test,
        ok: result.ok,
        output: typeof result.output === "string" ? result.output.slice(0, 2000) : JSON.stringify(result.output ?? "").slice(0, 2000),
        error: result.error,
      });
    }
    return results;
  }
}

function resolveInstallTarget(source: string): string {
  if (source.startsWith("github:")) {
    const repo = source.slice("github:".length).replace(/^\/+/, "");
    return `https://github.com/${repo}.git`;
  }
  if (source.startsWith("git:")) {
    return source.slice("git:".length);
  }
  throw new Error('Skill source must be "github:owner/repo" or "git:URL"');
}

function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return new Set(words);
}

const STOPWORDS = new Set([
  "the", "and", "for", "you", "your", "with", "that", "this", "have", "what", "when", "where", "which",
  "please", "using", "about", "from", "into", "will", "would", "should", "could", "then", "than", "there",
  "their", "them", "they", "were", "was", "are", "has", "had", "not", "but", "can", "use",
]);

function overlap(query: Set<string>, haystack: Set<string>): number {
  if (query.size === 0 || haystack.size === 0) return 0;
  let intersection = 0;
  for (const word of query) {
    if (haystack.has(word)) intersection++;
  }
  if (intersection === 0) return 0;
  const coverage = intersection / query.size;
  const union = query.size + haystack.size - intersection;
  const jaccard = intersection / union;
  return 0.7 * coverage + 0.3 * jaccard;
}

