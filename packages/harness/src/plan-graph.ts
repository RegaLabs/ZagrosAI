import { newId, now } from "@zagros/domain";
import type { ExecutionRequirements, TaskStep } from "@zagros/domain";
import type { IntentClassification } from "./intent.js";

export interface PlanStepBlueprint {
  objective: string;
  kind?: "model" | "tool" | "verify";
  toolId?: string;
  toolArgs?: Record<string, unknown>;
  dependencies?: string[]; // references by step index or id
  requirements?: Partial<ExecutionRequirements>;
}

export class PlanGraphCompiler {
  compile(
    taskId: string,
    intent: IntentClassification,
    userPrompt: string
  ): TaskStep[] {
    const steps: TaskStep[] = [];

    // Parse structured multi-step lines if present
    const lines = userPrompt
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[0-9]+[.)]\s+|^-\s+/.test(l));

    if (lines.length >= 2) {
      let previousStepId: string | undefined;
      for (const line of lines) {
        const objective = line.replace(/^[0-9]+[.)]\s+|^-\s+/, "").trim();
        const stepId = newId("step");
        steps.push({
          id: stepId,
          taskId,
          kind: "model",
          objective,
          dependencies: previousStepId ? [previousStepId] : [],
          requirements: {
            edge: false,
            browser: false,
            sandbox: false,
            shell: intent.suggestedRequirements?.shell ?? false,
            filesystem: intent.suggestedRequirements?.filesystem ?? false,
            docker: false,
            gpu: false,
          },
          status: "pending",
          attempts: 0,
          createdAt: now(),
          updatedAt: now(),
        });
        previousStepId = stepId;
      }
    } else if (intent.requiresPlanGraph) {
      // Default 3-phase graph: Analyze/Plan -> Execute -> Verify
      const step1Id = newId("step");
      const step2Id = newId("step");
      const step3Id = newId("step");

      steps.push({
        id: step1Id,
        taskId,
        kind: "model",
        objective: "Analyze task requirements and prepare workspace",
        dependencies: [],
        requirements: {
          edge: false,
          browser: false,
          sandbox: false,
          shell: false,
          filesystem: true,
          docker: false,
          gpu: false,
        },
        status: "pending",
        attempts: 0,
        createdAt: now(),
        updatedAt: now(),
      });

      steps.push({
        id: step2Id,
        taskId,
        kind: "model",
        objective: "Execute core implementation and tools",
        dependencies: [step1Id],
        requirements: {
          edge: false,
          browser: intent.suggestedRequirements?.browser ?? false,
          sandbox: false,
          shell: intent.suggestedRequirements?.shell ?? false,
          filesystem: intent.suggestedRequirements?.filesystem ?? true,
          docker: false,
          gpu: false,
        },
        status: "pending",
        attempts: 0,
        createdAt: now(),
        updatedAt: now(),
      });

      steps.push({
        id: step3Id,
        taskId,
        kind: "verify",
        objective: "Verify task outcomes and integrity of deliverables",
        dependencies: [step2Id],
        requirements: {
          edge: false,
          browser: false,
          sandbox: false,
          shell: false,
          filesystem: true,
          docker: false,
          gpu: false,
        },
        status: "pending",
        attempts: 0,
        createdAt: now(),
        updatedAt: now(),
      });
    }

    return steps;
  }

  getExecutableSteps(steps: TaskStep[]): TaskStep[] {
    const completedStepIds = new Set(
      steps.filter((s) => s.status === "completed" || s.status === "skipped").map((s) => s.id)
    );

    return steps.filter(
      (s) =>
        s.status === "pending" &&
        s.dependencies.every((depId) => completedStepIds.has(depId))
    );
  }
}
