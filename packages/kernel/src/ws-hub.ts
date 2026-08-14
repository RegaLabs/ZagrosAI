import type { Kernel } from "./kernel.js";
import type { WsClientSocket } from "./types.js";
import { clientEventSchema } from "@zagros/protocol";

export class WsClientHub {
  private readonly sockets = new Set<WsClientSocket>();

  constructor(private readonly kernel: Kernel) {
    this.kernel.events.subscribe((event) => {
      const payload = JSON.stringify(event);
      for (const socket of [...this.sockets]) {
        try {
          socket.send(payload);
        } catch {
          this.sockets.delete(socket);
        }
      }
    });
  }

  handleClientConnection(socket: WsClientSocket, query: Record<string, string>): void {
    void query;
    this.sockets.add(socket);
    void this.kernel
      .initWsHello()
      .then((hello) => {
        if (this.sockets.has(socket)) socket.send(JSON.stringify(hello));
      })
      .catch(() => {
        // client may have disconnected before hello was assembled
      });
    socket.onMessage((data) => {
      try {
        const raw = JSON.parse(data);
        const parsed = clientEventSchema.safeParse(raw);
        if (!parsed.success) return;
        const message = parsed.data;
        if (message.type === "ping") {
          socket.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // ignore malformed client messages
      }
    });
    socket.onClose(() => {
      this.sockets.delete(socket);
    });
  }

  count(): number {
    return this.sockets.size;
  }
}
