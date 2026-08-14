import type { ModelDriverId } from "@zagros/domain";
import type { ModelDriver } from "./types.js";

export type ModelDriverFactory = (config: ModelDriverConfig) => ModelDriver;

export interface ModelDriverConfig {
  driver: ModelDriverId | "fake";
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  imageInput?: boolean;
  harness?: string;
}

export class ModelRegistry {
  private readonly drivers = new Map<string, ModelDriver>();

  register(driver: ModelDriver): void {
    this.drivers.set(driver.id, driver);
  }

  get(id: string): ModelDriver | undefined {
    return this.drivers.get(id);
  }

  list(): ModelDriver[] {
    return [...this.drivers.values()];
  }
}
