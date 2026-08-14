import type { ExecutionRequirements } from "@zagros/domain";

export type IntentKind =
  | "conversational"
  | "single_tool"
  | "plan_graph"
  | "code_task"
  | "research"
  | "verification";

export interface IntentClassification {
  kind: IntentKind;
  confidence: number;
  requiresVerification: boolean;
  requiresPlanGraph: boolean;
  suggestedRequirements?: Partial<ExecutionRequirements>;
  description: string;
}

export class IntentClassifier {
  classify(text: string): IntentClassification {
    const trimmed = text.trim();
    const lower = trimmed.toLowerCase();

    // Verification intent
    if (
      lower.startsWith("verify ") ||
      lower.startsWith("audit ") ||
      lower.includes("check if") ||
      lower.includes("confirm that")
    ) {
      return {
        kind: "verification",
        confidence: 0.9,
        requiresVerification: true,
        requiresPlanGraph: false,
        suggestedRequirements: { filesystem: true },
        description: "Task requires evidence-based verification.",
      };
    }

    // Code task intent
    if (
      lower.includes("build") ||
      lower.includes("refactor") ||
      lower.includes("implement") ||
      lower.includes("fix ") ||
      lower.includes("debug ") ||
      lower.includes("write code") ||
      lower.includes("create file") ||
      lower.includes("git ") ||
      lower.includes("npm ") ||
      lower.includes("pnpm ")
    ) {
      const isComplex =
        trimmed.split("\n").length > 3 ||
        lower.includes("and then") ||
        lower.includes("step 1") ||
        lower.includes("pipeline");

      return {
        kind: isComplex ? "plan_graph" : "code_task",
        confidence: 0.88,
        requiresVerification: true,
        requiresPlanGraph: isComplex,
        suggestedRequirements: { shell: true, filesystem: true },
        description: isComplex
          ? "Multi-step software engineering task requiring DAG plan graph."
          : "Targeted software coding task.",
      };
    }

    // Research intent
    if (
      lower.startsWith("search ") ||
      lower.startsWith("find ") ||
      lower.startsWith("research ") ||
      lower.includes("browse") ||
      lower.includes("look up") ||
      lower.includes("fetch ")
    ) {
      return {
        kind: "research",
        confidence: 0.85,
        requiresVerification: false,
        requiresPlanGraph: false,
        suggestedRequirements: { browser: lower.includes("browse") || lower.includes("navigate") },
        description: "Information gathering or web research task.",
      };
    }

    // Single tool intent (slash command or explicit tool action)
    if (trimmed.startsWith("/") || lower.startsWith("run ") || lower.startsWith("execute ")) {
      return {
        kind: "single_tool",
        confidence: 0.92,
        requiresVerification: false,
        requiresPlanGraph: false,
        suggestedRequirements: { shell: true },
        description: "Direct tool execution.",
      };
    }

    // Multi-step complex plan
    if (
      trimmed.includes("\n1.") ||
      trimmed.includes("\n- ") ||
      (trimmed.includes("first") && trimmed.includes("then"))
    ) {
      return {
        kind: "plan_graph",
        confidence: 0.8,
        requiresVerification: true,
        requiresPlanGraph: true,
        description: "Composite multi-step task requiring structured planning.",
      };
    }

    // Default: conversational / direct ReAct
    return {
      kind: "conversational",
      confidence: 0.75,
      requiresVerification: false,
      requiresPlanGraph: false,
      description: "Direct conversational or exploratory interaction.",
    };
  }
}
