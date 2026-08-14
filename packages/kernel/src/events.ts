import type { ServerEvent } from "@zagros/protocol";

export class LocalEventBus {
  private readonly subscribers: Array<(event: ServerEvent) => void> = [];

  emit(event: ServerEvent): void {
    for (const listener of this.subscribers) {
      try {
        listener(event);
      } catch {
        // listener errors must not break the bus
      }
    }
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    this.subscribers.push(listener);
    return () => {
      const index = this.subscribers.indexOf(listener);
      if (index >= 0) this.subscribers.splice(index, 1);
    };
  }
}
