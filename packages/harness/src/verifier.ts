import type { Task, TaskStep } from "@zagros/domain";
import type { ToolResult } from "@zagros/tools";

export interface VerificationCheck {
  name: string;
  passed: boolean;
  details?: string;
}

export interface VerificationResult {
  verified: boolean;
  checks: VerificationCheck[];
  summary: string;
}

export class Verifier {
  verify(task: Task, finalAssistantText: string, toolResults: ToolResult[]): VerificationResult {
    const checks: VerificationCheck[] = [];

    // Check 1: Tool execution health
    if (toolResults.length > 0) {
      const failedTools = toolResults.filter((r) => !r.ok);
      const passed = failedTools.length === 0;
      checks.push({
        name: "tool_execution_integrity",
        passed,
        details: passed
          ? `All ${toolResults.length} tool executions completed successfully.`
          : `${failedTools.length} of ${toolResults.length} tool executions reported errors.`,
      });
    }

    // Check 2: Step status consistency
    const pendingSteps = task.steps.filter((s) => s.status === "pending" || s.status === "running");
    const failedSteps = task.steps.filter((s) => s.status === "failed");
    checks.push({
      name: "step_graph_resolution",
      passed: pendingSteps.length === 0 && failedSteps.length === 0,
      details:
        failedSteps.length > 0
          ? `${failedSteps.length} step(s) failed.`
          : pendingSteps.length > 0
          ? `${pendingSteps.length} step(s) remain unresolved.`
          : `All ${task.steps.length} task steps completed.`,
    });

    // Check 3: Output substance
    const hasSubstantiveOutput = finalAssistantText.trim().length > 10;
    checks.push({
      name: "output_substance",
      passed: hasSubstantiveOutput,
      details: hasSubstantiveOutput
        ? `Generated substantive response (${finalAssistantText.trim().length} chars).`
        : "Final output was empty or trivial.",
    });

    const allPassed = checks.every((c) => c.passed);
    const summary = allPassed
      ? `Task verified successfully (${checks.length}/${checks.length} checks passed).`
      : `Verification failed: ${checks.filter((c) => !c.passed).map((c) => c.name).join(", ")}.`;

    return {
      verified: allPassed,
      checks,
      summary,
    };
  }
}
