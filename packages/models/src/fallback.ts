import type { ModelConfig } from "@zagros/domain";
import {
  ModelDriverError,
  type ModelCapabilities,
  type ModelDriver,
  type ModelEvent,
  type ModelRequest,
  type ModelResponse,
} from "./types.js";

export interface FallbackEvent {
  failedDriverId: string;
  nextDriverId: string;
  error: Error;
  attemptIndex: number;
}

export interface FallbackDriverOptions {
  isRetryable?: (error: unknown) => boolean;
  onFallback?: (event: FallbackEvent) => void;
}

export function defaultIsRetryable(error: unknown): boolean {
  if (error instanceof ModelDriverError) {
    if (error.status === undefined) return true;
    // 429 (rate limit), 408 (timeout), 500, 502, 503, 504 are retryable/fallback-eligible
    return error.status === 429 || error.status === 408 || error.status >= 500;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("fetch failed") ||
      msg.includes("network") ||
      msg.includes("timeout") ||
      msg.includes("rate limit") ||
      msg.includes("429") ||
      msg.includes("500") ||
      msg.includes("502") ||
      msg.includes("503") ||
      msg.includes("504")
    );
  }
  return true;
}

export class FallbackDriver implements ModelDriver {
  readonly id = "fallback-chain";
  readonly config: ModelConfig;
  private readonly drivers: ModelDriver[];
  private readonly isRetryable: (error: unknown) => boolean;
  private readonly onFallback?: (event: FallbackEvent) => void;

  constructor(drivers: ModelDriver[], options?: FallbackDriverOptions) {
    if (drivers.length === 0) {
      throw new Error("FallbackDriver requires at least one driver");
    }
    this.drivers = drivers;
    this.config = drivers[0]!.config;
    this.isRetryable = options?.isRetryable ?? defaultIsRetryable;
    this.onFallback = options?.onFallback;
  }

  async capabilities(): Promise<ModelCapabilities> {
    return this.drivers[0]!.capabilities();
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    let lastError: Error | undefined;

    for (let i = 0; i < this.drivers.length; i++) {
      const driver = this.drivers[i]!;
      try {
        yield* driver.stream(request);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const hasNext = i + 1 < this.drivers.length;
        if (hasNext && this.isRetryable(err)) {
          const nextDriver = this.drivers[i + 1]!;
          if (this.onFallback) {
            this.onFallback({
              failedDriverId: driver.id,
              nextDriverId: nextDriver.id,
              error: lastError,
              attemptIndex: i,
            });
          }
          continue;
        }
        throw lastError;
      }
    }

    if (lastError) throw lastError;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    let lastError: Error | undefined;

    for (let i = 0; i < this.drivers.length; i++) {
      const driver = this.drivers[i]!;
      try {
        return await driver.generate(request);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const hasNext = i + 1 < this.drivers.length;
        if (hasNext && this.isRetryable(err)) {
          const nextDriver = this.drivers[i + 1]!;
          if (this.onFallback) {
            this.onFallback({
              failedDriverId: driver.id,
              nextDriverId: nextDriver.id,
              error: lastError,
              attemptIndex: i,
            });
          }
          continue;
        }
        throw lastError;
      }
    }

    throw lastError ?? new Error("All fallback drivers failed");
  }
}
