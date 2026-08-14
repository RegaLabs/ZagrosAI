import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export interface RunnerToolMeta {
  id: string;
  capability: "shell" | "filesystem" | "browser";
  description: string;
  schema: Record<string, unknown>;
  risk: "R0" | "R1" | "R2" | "R3";
}

function schemaOf(def: z.ZodTypeAny): Record<string, unknown> {
  return zodToJsonSchema(def, { name: "args" }) as Record<string, unknown>;
}

export const browserToolMeta: RunnerToolMeta[] = [
  {
    id: "browser.session.create",
    capability: "browser",
    description:
      "Create a browser session on an Zagros Runner. Use this first, then use the returned sessionId with the other browser tools. Optional profile name keeps a persistent browser profile across sessions.",
    schema: schemaOf(z.object({ profile: z.string().optional() })),
    risk: "R1",
  },
  {
    id: "browser.session.list",
    capability: "browser",
    description: "List open browser sessions with their current URL and title.",
    schema: schemaOf(z.object({})),
    risk: "R0",
  },
  {
    id: "browser.session.close",
    capability: "browser",
    description: "Close a browser session and release its resources.",
    schema: schemaOf(z.object({ sessionId: z.string().min(1) })),
    risk: "R1",
  },
  {
    id: "browser.navigate",
    capability: "browser",
    description:
      "Navigate a browser session to a URL and wait for the page to load. Returns the final URL and page title.",
    schema: schemaOf(z.object({ sessionId: z.string().min(1), url: z.string().url() })),
    risk: "R0",
  },
  {
    id: "browser.screenshot",
    capability: "browser",
    description:
      "Take a PNG screenshot of a browser session. Returns the image as base64, plus the viewport size. Use it to observe the current page.",
    schema: schemaOf(z.object({ sessionId: z.string().min(1), fullPage: z.boolean().default(false) })),
    risk: "R0",
  },
  {
    id: "browser.text",
    capability: "browser",
    description:
      "Read the visible text of an element matching a CSS selector (or the whole body if no selector is given).",
    schema: schemaOf(z.object({ sessionId: z.string().min(1), selector: z.string().optional() })),
    risk: "R0",
  },
  {
    id: "browser.click",
    capability: "browser",
    description: "Click the element matching a CSS selector in a browser session.",
    schema: schemaOf(z.object({ sessionId: z.string().min(1), selector: z.string().min(1) })),
    risk: "R1",
  },
  {
    id: "browser.type",
    capability: "browser",
    description:
      "Fill a text input matching a CSS selector with the given text, then optionally press Enter (submit=true).",
    schema: schemaOf(
      z.object({ sessionId: z.string().min(1), selector: z.string().min(1), text: z.string(), submit: z.boolean().default(false) })
    ),
    risk: "R1",
  },
  {
    id: "browser.evaluate",
    capability: "browser",
    description:
      "Run a JavaScript expression in the page and return the result. Use for inspecting DOM state that the other tools cannot reach.",
    schema: schemaOf(z.object({ sessionId: z.string().min(1), script: z.string().min(1) })),
    risk: "R1",
  },
];

export const filesListToolMeta: RunnerToolMeta = {
  id: "files.list",
  capability: "filesystem",
  description:
    "List the contents of a directory in the runner workspace. Returns entry names and types.",
  schema: schemaOf(z.object({ path: z.string().default(".") })),
  risk: "R0",
};
