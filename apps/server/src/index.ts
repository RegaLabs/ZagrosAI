import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { Kernel, WsClientHub, buildHttpRoutes } from "@zagros/kernel";
import type { HttpRouteTable } from "@zagros/kernel";
import { generateMasterKey } from "@zagros/credentials";
import { registerConnectors } from "@zagros/connectors";
import { runnerHelloSchema } from "@zagros/protocol";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { FsObjectStore } from "./objects.js";
import { SqliteRepos } from "./repos.js";
import { Store } from "./store.js";

function loadMasterKey(config: ReturnType<typeof loadConfig>): string | undefined {
  const fromEnv = process.env.ZAGROS_MASTER_KEY;
  if (fromEnv) return fromEnv;
  const keyPath = join(config.dataDir, "master.key");
  if (existsSync(keyPath)) return readFileSync(keyPath, "utf-8").trim();
  const generated = generateMasterKey();
  writeFileSync(keyPath, generated, { mode: 0o600 });
  console.warn(
    `[zagros] No ZAGROS_MASTER_KEY set — generated one at ${keyPath}. Keep it secret; it encrypts OAuth credentials.`
  );
  return generated;
}

function registerHttpAdapter(app: FastifyInstance, table: HttpRouteTable): void {
  for (const [method, routes] of Object.entries(table) as Array<[keyof HttpRouteTable, Map<string, unknown>]>) {
    for (const [path, handler] of routes) {
      const routeHandler = handler as HttpRouteTable["get"] extends Map<string, infer H> ? H : never;
      app.route({
        method: method.toUpperCase(),
        url: path,
        handler: async (request, reply) => {
          let upload: { name: string; mimeType?: string; data: Uint8Array } | undefined;
          if (method === "post" && path === "/api/uploads") {
            const file = await request.file({ limits: { fileSize: 50 * 1024 * 1024 } });
            if (file) {
              const chunks: Buffer[] = [];
              for await (const chunk of file.file) {
                chunks.push(Buffer.from(chunk));
              }
              upload = { name: file.filename, mimeType: file.mimetype, data: Buffer.concat(chunks) };
            }
          }
          const result = await routeHandler({
            params: (request.params as Record<string, string>) ?? {},
            query: (request.query as Record<string, string>) ?? {},
            body: request.body,
            headers: request.headers as Record<string, string>,
            upload,
            ip: request.ip,
          });
          reply.code(result.status);
          if (result.headers) {
            for (const [key, value] of Object.entries(result.headers)) {
              reply.header(key, value);
            }
          }
          if (result.raw) {
            reply.send(result.body as string);
          } else {
            reply.send(result.body);
          }
        },
      });
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: undefined,
    },
    bodyLimit: 16 * 1024 * 1024,
  });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
  await app.register(staticPlugin, {
    root: config.uploadsDir,
    prefix: "/uploads/",
    decorateReply: false,
  });
  await app.register(websocket);

  const store = new Store(`${config.dataDir}/zagros.db`);
  const repos = new SqliteRepos(store);
  const objects = new FsObjectStore(config.uploadsDir);
  const masterKey = loadMasterKey(config);
  const kernel = new Kernel(
    {
      defaultWorkspace: config.defaultWorkspace,
      version: "1.0.0",
      stdioMcpEnabled: true,
      masterKey,
      publicBaseUrl: process.env.ZAGROS_PUBLIC_URL ?? `http://127.0.0.1:${config.port}`,
      skillsDir: process.env.ZAGROS_SKILLS_DIR ?? join(process.cwd(), "skills"),
      skillPublicKey: process.env.ZAGROS_SKILL_PUBLIC_KEY,
      rateLimitPerMinute: process.env.ZAGROS_RATE_LIMIT ? Number(process.env.ZAGROS_RATE_LIMIT) : undefined,
      maxConcurrentTasks: process.env.ZAGROS_MAX_TASKS ? Number(process.env.ZAGROS_MAX_TASKS) : undefined,
    },
    repos,
    objects
  );
  registerConnectors(kernel, {
    google: {
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      authorizeUrl: process.env.GOOGLE_OAUTH_AUTHORIZE_URL,
      tokenUrl: process.env.GOOGLE_OAUTH_TOKEN_URL,
      apiBase: process.env.GOOGLE_OAUTH_API_BASE,
    },
    github: {
      clientId: process.env.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
      authorizeUrl: process.env.GITHUB_OAUTH_AUTHORIZE_URL,
      tokenUrl: process.env.GITHUB_OAUTH_TOKEN_URL,
      apiBase: process.env.GITHUB_OAUTH_API_BASE,
    },
  });
  await kernel.init();
  registerHttpAdapter(app, buildHttpRoutes(kernel));

  const hub = new WsClientHub(kernel);

  app.get("/ws", { websocket: true }, (socket: import("ws").WebSocket) => {
    hub.handleClientConnection(
      {
        send: (data) => {
          if (socket.readyState === socket.OPEN) {
            try {
              socket.send(data);
            } catch {}
          }
        },
        close: (code, reason) => socket.close(code, reason),
        onMessage: (listener) => {
          socket.on("message", (data: unknown) =>
            listener(typeof data === "string" ? data : (data as Buffer).toString())
          );
        },
        onClose: (listener) => {
          let called = false;
          const onceListener = () => {
            if (!called) {
              called = true;
              listener();
            }
          };
          socket.once("close", onceListener);
          socket.once("error", onceListener);
        },
      },
      {}
    );
  });

  app.get("/ws/runner", { websocket: true }, (socket: import("ws").WebSocket) => {
    let connected = false;
    const runnerSocket = {
      send: (data: string) => {
        if (socket.readyState === socket.OPEN) {
          try {
            socket.send(data);
          } catch {}
        }
      },
      close: (code?: number, reason?: string) => socket.close(code, reason),
      onMessage: (listener: (data: string) => void) => {
        socket.on("message", (data: unknown) =>
          listener(typeof data === "string" ? data : (data as Buffer).toString())
        );
      },
      onClose: (listener: () => void) => {
        let called = false;
        const onceListener = () => {
          if (!called) {
            called = true;
            listener();
          }
        };
        socket.once("close", onceListener);
        socket.once("error", onceListener);
      },
    };

    const helloHandler = (data: unknown) => {
      if (connected) return;
      let raw: unknown;
      try {
        raw = JSON.parse(typeof data === "string" ? data : (data as Buffer).toString());
      } catch {
        runnerSocket.close(4000, "malformed runner message");
        return;
      }
      const hello = runnerHelloSchema.safeParse(raw);
      if (hello.success) {
        connected = true;
        socket.removeListener("message", helloHandler);
        void kernel.workers.handleRunnerConnection(runnerSocket, hello.data);
      }
    };

    socket.on("message", helloHandler);
  });

  kernel.startHeartbeat();
  kernel.startRoutineLoop();

  await app.listen({ host: config.host, port: config.port });
  app.log.info(`Zagros v0.1.0 listening on http://${config.host}:${config.port}`);
  app.log.info(`Data directory: ${config.dataDir}`);
  const settings = await kernel.getSettings();
  app.log.info(`Runner token: ${settings.runnerToken}`);
}

main().catch((err) => {
  console.error("Failed to start Zagros server:", err);
  process.exit(1);
});
