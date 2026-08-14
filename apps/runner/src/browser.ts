import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

const MAX_SESSIONS = 10;
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 mins
const MAX_SCREENSHOT_DIMENSION = 10_000;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_TEXT_BYTES = 512 * 1024; // 512 KB
const MAX_EVALUATE_RESULT_BYTES = 256 * 1024; // 256 KB

interface BrowserSessionRecord {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  url: string;
  title: string;
  createdAt: string;
  lastActiveAt: string;
}

export interface BrowserSessionView {
  id: string;
  url: string;
  title: string;
  createdAt: string;
  lastActiveAt: string;
}

export class BrowserManager {
  private readonly sessions = new Map<string, BrowserSessionRecord>();
  private launchPromise: Promise<Browser> | undefined;

  constructor(
    private readonly profileDir: string,
    private readonly channel: string | undefined
  ) {}

  private async launch(): Promise<Browser> {
    if (this.launchPromise) {
      try {
        const b = await this.launchPromise;
        if (b.isConnected()) {
          return b;
        }
      } catch {
        // Previous launch promise failed, clear and retry
      }
      this.launchPromise = undefined;
    }

    this.launchPromise = chromium
      .launch({
        channel: this.channel,
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      })
      .then((browser) => {
        browser.on("disconnected", () => {
          this.launchPromise = undefined;
        });
        return browser;
      })
      .catch((err) => {
        this.launchPromise = undefined;
        throw new Error(
          `Could not start a browser on this runner: ${
            err instanceof Error ? err.message : String(err)
          }. Install Chrome/Chromium or run: pnpm exec playwright install chromium`
        );
      });

    return this.launchPromise;
  }

  private async cleanupIdleSessions(): Promise<void> {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      const active = new Date(session.lastActiveAt).getTime();
      if (now - active > SESSION_IDLE_TIMEOUT_MS) {
        await this.closeSession(id).catch(() => undefined);
      }
    }
  }

  async createSession(profile?: string): Promise<BrowserSessionView> {
    await this.cleanupIdleSessions();

    if (profile) {
      if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
        throw new Error(`Invalid browser profile name: "${profile}". Only alphanumeric characters, hyphens, and underscores are allowed.`);
      }
    }

    if (this.sessions.size >= MAX_SESSIONS) {
      // Evict least-recently-used session
      const sorted = [...this.sessions.values()].sort((a, b) => a.lastActiveAt.localeCompare(b.lastActiveAt));
      const oldest = sorted[0];
      if (oldest) {
        await this.closeSession(oldest.id);
      }
    }

    const timestamp = new Date().toISOString();
    let context: BrowserContext;
    let page: Page;
    let browser: Browser;

    if (profile) {
      const dir = join(this.profileDir, profile);
      mkdirSync(dir, { recursive: true });
      const persistent = await chromium.launchPersistentContext(dir, {
        channel: this.channel,
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        viewport: { width: 1280, height: 800 },
      });
      const persistentBrowser = persistent.browser();
      if (!persistentBrowser) {
        throw new Error("Could not obtain browser handle for persistent profile");
      }
      browser = persistentBrowser;
      context = persistent;
      page = context.pages()[0] ?? (await context.newPage());
    } else {
      const shared = await this.launch();
      context = await shared.newContext({ viewport: { width: 1280, height: 800 } });
      page = await context.newPage();
      browser = shared;
    }

    const record: BrowserSessionRecord = {
      id: `brows_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
      browser,
      context,
      page,
      url: "about:blank",
      title: "New session",
      createdAt: timestamp,
      lastActiveAt: timestamp,
    };
    this.sessions.set(record.id, record);
    return this.view(record);
  }

  list(): BrowserSessionView[] {
    return [...this.sessions.values()].map((s) => this.view(s));
  }

  async closeSession(id: string): Promise<boolean> {
    const record = this.sessions.get(id);
    if (!record) return false;
    this.sessions.delete(id);
    try {
      await Promise.race([
        record.context.close(),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch {
      // ignore
    }
    return true;
  }

  async closeAll(): Promise<void> {
    const sessionClosePromises = [...this.sessions.keys()].map((id) => this.closeSession(id));
    await Promise.allSettled(sessionClosePromises);
    if (this.launchPromise) {
      try {
        const shared = await this.launchPromise;
        await Promise.race([
          shared.close(),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      } catch {
        // ignore
      }
      this.launchPromise = undefined;
    }
  }

  private require(id: string): BrowserSessionRecord {
    const record = this.sessions.get(id);
    if (!record) throw new Error(`Browser session not found: ${id}. Create one with browser.session.create first.`);
    record.lastActiveAt = new Date().toISOString();
    return record;
  }

  private view(record: BrowserSessionRecord): BrowserSessionView {
    return {
      id: record.id,
      url: record.url,
      title: record.title,
      createdAt: record.createdAt,
      lastActiveAt: record.lastActiveAt,
    };
  }

  async navigate(id: string, url: string): Promise<{ url: string; title: string }> {
    if (!/^https?:\/\/|^about:blank/i.test(url)) {
      throw new Error(`Unsupported URL protocol: "${url}". Only http, https, and about:blank are allowed.`);
    }
    const record = this.require(id);
    await record.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    record.url = record.page.url();
    record.title = await record.page.title().catch(() => "");
    return { url: record.url, title: record.title };
  }

  async screenshot(id: string, fullPage: boolean): Promise<{ imageBase64: string; width: number; height: number; contentType: string }> {
    const record = this.require(id);
    let clip: { x: number; y: number; width: number; height: number } | undefined;

    if (fullPage) {
      const dimensions = await (record.page.evaluate(
        '(() => { const doc = document.documentElement; return { width: Math.max(doc.scrollWidth, doc.clientWidth, window.innerWidth || 1280), height: Math.max(doc.scrollHeight, doc.clientHeight, window.innerHeight || 800) }; })()'
      ) as Promise<{ width: number; height: number }>).catch(() => ({ width: 1280, height: 800 }));

      if (dimensions.height > MAX_SCREENSHOT_DIMENSION || dimensions.width > MAX_SCREENSHOT_DIMENSION) {
        clip = {
          x: 0,
          y: 0,
          width: Math.min(dimensions.width, MAX_SCREENSHOT_DIMENSION),
          height: Math.min(dimensions.height, MAX_SCREENSHOT_DIMENSION),
        };
      }
    }

    const buffer = await record.page.screenshot({
      type: "png",
      fullPage: clip ? false : fullPage,
      clip,
      timeout: 15_000,
    });

    if (buffer.length > MAX_SCREENSHOT_BYTES) {
      throw new Error(`Screenshot size (${Math.round(buffer.length / 1024)}KB) exceeds maximum limit of ${MAX_SCREENSHOT_BYTES / (1024 * 1024)}MB`);
    }

    const viewport = record.page.viewportSize() ?? { width: 1280, height: 800 };
    return {
      imageBase64: buffer.toString("base64"),
      width: clip ? clip.width : viewport.width,
      height: clip ? clip.height : viewport.height,
      contentType: "image/png",
    };
  }

  async text(id: string, selector?: string): Promise<{ text: string }> {
    const record = this.require(id);
    const text = selector
      ? await record.page.textContent(selector, { timeout: 10_000 }).catch(() => null)
      : await record.page.locator("body").innerText({ timeout: 10_000 }).catch(() => null);
    const raw = text ?? "";
    return { text: raw.length > MAX_TEXT_BYTES ? raw.slice(0, MAX_TEXT_BYTES) : raw };
  }

  async click(id: string, selector: string): Promise<{ ok: true }> {
    const record = this.require(id);
    await record.page.click(selector, { timeout: 15_000 });
    return { ok: true };
  }

  async type(id: string, selector: string, text: string, submit: boolean): Promise<{ ok: true }> {
    const record = this.require(id);
    await record.page.fill(selector, text, { timeout: 15_000 });
    if (submit) {
      await record.page.keyboard.press("Enter");
    }
    return { ok: true };
  }

  async evaluate(id: string, script: string): Promise<{ result: unknown }> {
    const record = this.require(id);
    const result = await record.page.evaluate((expr: string) => {
      const fn = new Function(`return (${expr});`);
      const value = fn();
      if (value === undefined) return null;
      const maybeNode = value as { nodeType?: number; textContent?: string | null; outerHTML?: string | null };
      if (maybeNode && typeof maybeNode === "object" && typeof maybeNode.nodeType === "number") {
        return { node: maybeNode.nodeType, text: maybeNode.textContent ?? null, html: maybeNode.outerHTML?.slice(0, 2000) ?? null };
      }
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return String(value).slice(0, 4000);
      }
    }, script);

    let serialized: string;
    try {
      serialized = JSON.stringify(result);
    } catch {
      serialized = String(result);
    }

    if (serialized.length > MAX_EVALUATE_RESULT_BYTES) {
      return { result: serialized.slice(0, MAX_EVALUATE_RESULT_BYTES) + "... [truncated]" };
    }

    return { result };
  }
}

