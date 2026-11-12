import { chargeKnownUsage, type BudgetCaps } from "../execution/budget";
import type { EvalAssertion } from "./assertions";

export async function gradeWithPromptfoo(input: {
  output: string;
  tools: string[];
  costUsd: number | null;
  latencyMs: number | null;
  assertions: EvalAssertion[];
  model: string;
  apiKey?: string;
  userId: string;
  caps: BudgetCaps;
}): Promise<{ passed: boolean; score: number; details: unknown; gradingTokens: number }> {
  if (input.assertions.length === 0) {
    return { passed: true, score: 1, details: { assertions: [] }, gradingTokens: 0 };
  }
  const needsModel = input.assertions.some((assertion) => assertion.type === "llm_rubric");
  if (needsModel && !input.apiKey) {
    return {
      passed: false,
      score: 0,
      details: { error: "openai_not_configured" },
      gradingTokens: 0,
    };
  }
  const assert = input.assertions.map((assertion) => {
    if (assertion.type === "contains") return { type: "contains", value: assertion.value };
    if (assertion.type === "expected_tools") {
      return {
        type: "javascript",
        value: `const tools = JSON.parse(context.vars.tools); return ${JSON.stringify(assertion.tools)}.every((tool) => tools.includes(tool));`,
      };
    }
    if (assertion.type === "max_cost_usd") {
      return {
        type: "javascript",
        value: `const cost = Number(context.vars.cost); return Number.isFinite(cost) && cost <= ${assertion.value};`,
      };
    }
    if (assertion.type === "max_latency_ms") {
      return {
        type: "javascript",
        value: `const latency = Number(context.vars.latency); return Number.isFinite(latency) && latency <= ${assertion.value};`,
      };
    }
    return { type: "llm-rubric", value: assertion.value };
  });
  const promptfoo = (await import("promptfoo")) as {
    evaluate: (suite: unknown, options?: unknown) => Promise<{
      results: Array<{
        success?: boolean;
        score?: number;
        gradingResult?: { tokensUsed?: { total?: number; prompt?: number; completion?: number }; componentResults?: unknown };
        response?: { tokenUsage?: { total?: number } };
      }>;
    }>;
  };
  const summary = await promptfoo.evaluate(
    {
      description: "orvia evaluation",
      prompts: ["{{task}}"],
      providers: [
        {
          id: "orvia:stored-output",
          callApi: async () => ({ output: input.output }),
        },
      ],
      tests: [
        {
          vars: {
            task: "grade the stored execution",
            tools: JSON.stringify(input.tools),
            cost: String(input.costUsd ?? ""),
            latency: String(input.latencyMs ?? ""),
          },
          assert,
        },
      ],
      defaultTest: needsModel ? { options: { provider: `openai:${input.model}` } } : undefined,
    },
    { maxConcurrency: 1, cache: false, showProgressBar: false, progressBar: false },
  );
  const result = summary.results?.[0];
  const passed = Boolean(result?.success);
  const score = typeof result?.score === "number" ? result.score : passed ? 1 : 0;
  const gradingTokens = result?.gradingResult?.tokensUsed?.total ?? result?.response?.tokenUsage?.total ?? 0;
  if (gradingTokens > 0) {
    const charged = await chargeKnownUsage({ userId: input.userId, tokens: gradingTokens, caps: input.caps });
    if (charged === "budget_exceeded") {
      return { passed: false, score: 0, details: { error: "budget_exceeded", grading: result?.gradingResult ?? null }, gradingTokens: 0 };
    }
  }
  return {
    passed,
    score,
    details: { componentResults: result?.gradingResult?.componentResults ?? result?.gradingResult ?? null },
    gradingTokens,
  };
}
