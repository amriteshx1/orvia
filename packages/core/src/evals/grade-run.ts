import { prisma } from "@orvia/db";
import { ACTIVE_STATUSES } from "../execution/constants";
import { parseAssertions } from "./assertions";
import { gradeWithPromptfoo } from "./grade";
import { pumpEvaluations, type EvalRuntime } from "./service";

export async function gradeExecutionIfNeeded(executionId: string, runtime: EvalRuntime) {
  const linked = await prisma.evaluationCaseResult.findUnique({
    where: { executionId },
    include: { case: true, execution: { include: { steps: true } } },
  });
  if (!linked?.execution || linked.passed !== null) return;
  const execution = linked.execution;
  if (ACTIVE_STATUSES.includes(execution.status as (typeof ACTIVE_STATUSES)[number])) return;
  const tools = [
    ...new Set(
      execution.steps.filter((step) => step.kind === "tool" && step.toolName).map((step) => step.toolName as string),
    ),
  ];
  const latencyMs =
    execution.startedAt && execution.finishedAt ? execution.finishedAt.getTime() - execution.startedAt.getTime() : null;
  const assertions = parseAssertions(linked.case.assertions);
  let graded: { passed: boolean; score: number; details: unknown; gradingTokens: number } = {
    passed: execution.status === "succeeded",
    score: execution.status === "succeeded" ? 1 : 0,
    details: { status: execution.status },
    gradingTokens: 0,
  };
  if (execution.status === "succeeded") {
    try {
      graded = await gradeWithPromptfoo({
        output: execution.finalText ?? "",
        tools,
        costUsd: execution.estimatedCostUsd,
        latencyMs,
        assertions,
        model: runtime.openAiModel,
        apiKey: runtime.openAiApiKey,
        userId: execution.userId,
        caps: { monthlyTokenCap: runtime.monthlyTokenCap, concurrentRunCap: runtime.concurrentRunCap },
      });
    } catch (error) {
      graded = {
        passed: false,
        score: 0,
        details: { error: error instanceof Error ? error.name : "grade_failed" },
        gradingTokens: 0,
      };
    }
  }
  await prisma.evaluationCaseResult.update({
    where: { id: linked.id },
    data: {
      passed: graded.passed,
      score: graded.score,
      tools,
      costUsd: execution.estimatedCostUsd,
      latencyMs,
      details: graded.details as object,
    },
  });
  const open = await prisma.evaluationCaseResult.count({
    where: {
      runId: linked.runId,
      OR: [{ passed: null }, { executionId: null }],
    },
  });
  if (open === 0) {
    await prisma.evaluationRun.updateMany({
      where: { id: linked.runId, status: "running" },
      data: { status: "completed", finishedAt: new Date() },
    });
  } else {
    await pumpEvaluations(runtime);
  }
}
