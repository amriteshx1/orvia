import { prisma } from "@orvia/db";
import { NotFoundError, ValidationError } from "../agents/schema";
import { ensureBudget } from "../execution/budget";
import { ACTIVE_STATUSES } from "../execution/constants";
import { enqueueRun } from "../execution/queue";
import type { EvalAssertion } from "./assertions";

export type EvalRuntime = {
  redisUrl: string;
  queuePrefix: string;
  monthlyTokenCap: number;
  concurrentRunCap: number;
  openAiApiKey?: string;
  openAiModel: string;
};

export async function listDatasets(userId: string) {
  const rows = await prisma.evaluationDataset.findMany({
    where: { userId },
    include: { _count: { select: { cases: true, runs: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    cases: row._count.cases,
    runs: row._count.runs,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function getDataset(userId: string, datasetId: string) {
  const row = await prisma.evaluationDataset.findFirst({
    where: { id: datasetId, userId },
    include: {
      cases: { orderBy: { position: "asc" } },
      runs: {
        orderBy: { createdAt: "desc" },
        include: {
          agent: { select: { name: true } },
          agentVersion: { select: { versionNumber: true } },
          results: true,
        },
      },
    },
  });
  if (!row) throw new NotFoundError();
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    cases: row.cases.map((item) => ({
      id: item.id,
      name: item.name,
      task: item.task,
      assertions: item.assertions,
      position: item.position,
    })),
    runs: row.runs.map((run) => summarizeRun(run)),
  };
}

export async function createDataset(userId: string, value: unknown) {
  const body = record(value);
  const name = text(body.name, 80);
  if (!name) throw new ValidationError([{ path: "name", message: "A name is required" }]);
  const created = await prisma.evaluationDataset.create({
    data: { userId, name, description: text(body.description, 2_000) },
  });
  return getDataset(userId, created.id);
}

export async function addCase(userId: string, datasetId: string, value: unknown) {
  const dataset = await prisma.evaluationDataset.findFirst({ where: { id: datasetId, userId } });
  if (!dataset) throw new NotFoundError();
  const body = record(value);
  const name = text(body.name, 80);
  const task = text(body.task, 20_000);
  if (!name || !task) throw new ValidationError([{ path: "task", message: "A name and task are required" }]);
  const assertions = assertionsFromInput(body);
  const last = await prisma.evaluationCase.aggregate({ where: { datasetId }, _max: { position: true } });
  await prisma.evaluationCase.create({
    data: {
      datasetId,
      userId,
      name,
      task,
      assertions,
      position: (last._max.position ?? -1) + 1,
    },
  });
  return getDataset(userId, datasetId);
}

export async function deleteCase(userId: string, datasetId: string, caseId: string) {
  const deleted = await prisma.evaluationCase.deleteMany({ where: { id: caseId, datasetId, userId } });
  if (deleted.count !== 1) throw new NotFoundError();
  return getDataset(userId, datasetId);
}

export async function startEvaluationRun(userId: string, datasetId: string, agentId: string, versionId: string | undefined, runtime: EvalRuntime) {
  const dataset = await prisma.evaluationDataset.findFirst({
    where: { id: datasetId, userId },
    include: { cases: { orderBy: { position: "asc" } } },
  });
  if (!dataset) throw new NotFoundError();
  if (dataset.cases.length === 0) {
    throw new ValidationError([{ path: "cases", message: "Add a case before running the dataset" }]);
  }
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, userId, archivedAt: null },
    include: { versions: true },
  });
  if (!agent) throw new NotFoundError();
  const version = versionId ? agent.versions.find((item) => item.id === versionId) : agent.versions.find((item) => item.id === agent.currentVersionId);
  if (!version) throw new NotFoundError();
  const run = await prisma.evaluationRun.create({
    data: {
      userId,
      datasetId,
      agentId,
      agentVersionId: version.id,
      status: "running",
      results: {
        create: dataset.cases.map((item) => ({ caseId: item.id, userId })),
      },
    },
  });
  await pumpEvaluations(runtime);
  return getRun(userId, run.id);
}

export async function getRun(userId: string, runId: string) {
  const run = await prisma.evaluationRun.findFirst({
    where: { id: runId, userId },
    include: {
      agent: { select: { name: true } },
      agentVersion: { select: { versionNumber: true } },
      results: { include: { case: true, execution: { select: { status: true, task: true } } } },
    },
  });
  if (!run) throw new NotFoundError();
  return {
    ...summarizeRun(run),
    results: run.results.map((result) => ({
      id: result.id,
      caseId: result.caseId,
      caseName: result.case.name,
      task: result.case.task,
      executionId: result.executionId,
      executionStatus: result.execution?.status ?? null,
      passed: result.passed,
      score: result.score,
      tools: result.tools,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
      details: result.details,
    })),
  };
}

export async function compareRuns(userId: string, leftId: string, rightId: string) {
  const [left, right] = await Promise.all([getRun(userId, leftId), getRun(userId, rightId)]);
  return { left, right };
}

export async function pumpEvaluations(runtime: EvalRuntime) {
  const pending = await prisma.evaluationCaseResult.findMany({
    where: { executionId: null, run: { status: "running" } },
    include: { run: true, case: true },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  for (const result of pending) {
    const executionId = await prisma.$transaction(async (tx) => {
      await ensureBudget(tx, result.userId, runtime);
      await tx.$queryRaw`SELECT "userId" FROM user_budget WHERE "userId" = ${result.userId} FOR UPDATE`;
      const active = await tx.execution.count({
        where: { userId: result.userId, status: { in: [...ACTIVE_STATUSES] } },
      });
      if (active >= runtime.concurrentRunCap) return null;
      const current = await tx.evaluationCaseResult.findFirst({ where: { id: result.id, executionId: null } });
      if (!current) return null;
      const execution = await tx.execution.create({
        data: {
          userId: result.userId,
          agentId: result.run.agentId,
          agentVersionId: result.run.agentVersionId,
          task: result.case.task,
          status: "queued",
        },
      });
      await tx.evaluationCaseResult.update({ where: { id: result.id }, data: { executionId: execution.id } });
      return execution.id;
    });
    if (executionId) await enqueueRun(runtime.redisUrl, runtime.queuePrefix, executionId);
  }
}

function assertionsFromInput(body: Record<string, unknown>): EvalAssertion[] {
  const assertions: EvalAssertion[] = [];
  const contains = Array.isArray(body.contains) ? body.contains : typeof body.contains === "string" ? body.contains.split("\n") : [];
  for (const value of contains) {
    if (typeof value === "string" && value.trim()) assertions.push({ type: "contains", value: value.trim() });
  }
  const tools = Array.isArray(body.expectedTools)
    ? body.expectedTools
    : typeof body.expectedTools === "string"
      ? body.expectedTools.split(/[,\s]+/)
      : [];
  const toolNames = tools.filter((tool): tool is string => typeof tool === "string" && tool.trim().length > 0).map((tool) => tool.trim());
  if (toolNames.length > 0) assertions.push({ type: "expected_tools", tools: toolNames });
  if (typeof body.maxCostUsd === "number" && body.maxCostUsd >= 0) assertions.push({ type: "max_cost_usd", value: body.maxCostUsd });
  if (typeof body.maxLatencyMs === "number" && body.maxLatencyMs >= 0) assertions.push({ type: "max_latency_ms", value: body.maxLatencyMs });
  if (typeof body.rubric === "string" && body.rubric.trim()) assertions.push({ type: "llm_rubric", value: body.rubric.trim() });
  return assertions;
}

function summarizeRun(run: {
  id: string;
  datasetId?: string;
  agentId: string;
  agentVersionId: string;
  status: string;
  createdAt: Date;
  finishedAt: Date | null;
  agent: { name: string };
  agentVersion: { versionNumber: number };
  results: Array<{ passed: boolean | null; score: number | null; costUsd: number | null; latencyMs: number | null; tools: unknown }>;
}) {
  const scored = run.results.filter((result) => result.passed !== null);
  const passed = scored.filter((result) => result.passed).length;
  const cost = run.results.reduce((sum, result) => sum + (result.costUsd ?? 0), 0);
  const latencies = run.results.map((result) => result.latencyMs).filter((value): value is number => value !== null);
  const tools = new Set<string>();
  for (const result of run.results) {
    if (Array.isArray(result.tools)) {
      for (const toolName of result.tools) if (typeof toolName === "string") tools.add(toolName);
    }
  }
  return {
    id: run.id,
    datasetId: run.datasetId,
    agentId: run.agentId,
    agentName: run.agent.name,
    agentVersionId: run.agentVersionId,
    versionNumber: run.agentVersion.versionNumber,
    status: run.status,
    createdAt: run.createdAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    cases: run.results.length,
    passed,
    score: scored.length === 0 ? null : passed / scored.length,
    costUsd: cost,
    averageLatencyMs: latencies.length === 0 ? null : Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
    tools: [...tools],
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
