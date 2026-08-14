export class WebSocketClient {
  private socket: WebSocket | null = null;
  onmessage: ((data: unknown) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onopen: (() => void) | null = null;

  constructor(private readonly url: string) {}

  connect(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onmessage = (event) => {
      let data: unknown;
      try {
        data = JSON.parse(String(event.data));
      } catch {
        data = String(event.data);
      }
      this.onmessage?.(data);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.onclose?.(event);
    };
    socket.onerror = () => {
      socket.close();
    };
    socket.onopen = () => {
      this.onopen?.();
    };
  }

  send(data: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  }

  close(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
