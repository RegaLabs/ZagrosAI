import type { ModelDriver, ModelRequest } from "./types.js";
import { FallbackDriver } from "./fallback.js";

export type TaskCategory = "code" | "fast" | "cheap" | "vision" | "reasoning" | "local" | "general" | string;

export interface RoutingRule {
  task: TaskCategory;
  primary: ModelDriver;
  fallbacks?: ModelDriver[];
  requiredCapabilities?: {
    imageInput?: boolean;
    toolCalling?: boolean;
    reasoningControls?: boolean;
  };
}

export class ModelRouter {
  private readonly rules = new Map<string, RoutingRule>();
  private defaultDriver?: ModelDriver;

  constructor(defaultDriver?: ModelDriver) {
    this.defaultDriver = defaultDriver;
  }

  setDefaultDriver(driver: ModelDriver): void {
    this.defaultDriver = driver;
  }

  registerRule(rule: RoutingRule): void {
    this.rules.set(rule.task.toLowerCase(), rule);
  }

  getDriverForTask(task: TaskCategory): ModelDriver {
    const key = task.toLowerCase();
    const rule = this.rules.get(key);

    if (rule) {
      if (rule.fallbacks && rule.fallbacks.length > 0) {
        return new FallbackDriver([rule.primary, ...rule.fallbacks]);
      }
      return rule.primary;
    }

    if (!this.defaultDriver) {
      throw new Error(`ModelRouter: No driver registered for task '${task}' and no default driver set`);
    }

    return this.defaultDriver;
  }

  async routeAndExecute(task: TaskCategory, request: ModelRequest): Promise<unknown> {
    const driver = this.getDriverForTask(task);
    return driver.generate(request);
  }
}
