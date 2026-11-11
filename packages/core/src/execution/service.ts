import { prisma } from "@orvia/db";
import { z } from "zod";
import { readAgentSnapshot } from "../agents";
import { NotFoundError, ValidationError } from "../agents/schema";
import { safeErrorMessage } from "./constants";
import { LimitError } from "./errors";
import { ensureBudget, type BudgetCaps } from "./budget";
import { decideApproval } from "./approvals";
import { publishExecution } from "./publish";
import { enqueueRun } from "./queue";

const taskSchema = z.string().trim().min(1, "A task is required").max(20_000);

export type ExecutionRuntime = BudgetCaps & {
  redisUrl: string;
  queuePrefix: string;
  approvalTimeoutHours: number;
};

export async function createExecution(
  userId: string,
  agentId: string,
  taskValue: unknown,
  runtime: ExecutionRuntime,
) {
  const parsed = taskSchema.safeParse(taskValue);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((issue) => ({ path: "task", message: issue.message })),
    );
  }
  const task = parsed.data;
  const execution = await prisma.$transaction(async (tx) => {
    await ensureBudget(tx, userId, runtime);
    await tx.$queryRaw`SELECT "userId" FROM user_budget WHERE "userId" = ${userId} FOR UPDATE`;
    const active = await tx.execution.count({
      where: { userId, status: { in: ["queued", "running", "waitingApproval"] } },
    });
    if (active >= runtime.concurrentRunCap) {
      throw new LimitError("The concurrent run limit has been reached.");
    }
    const agent = await tx.agent.findFirst({
      where: { id: agentId, userId, archivedAt: null },
      include: { currentVersion: true },
    });
    if (!agent?.currentVersion || !agent.currentVersionId) throw new NotFoundError();
    return tx.execution.create({
      data: {
        userId,
        agentId: agent.id,
        agentVersionId: agent.currentVersionId,
        task,
        status: "queued",
      },
    });
  });
  try {
    await enqueueRun(runtime.redisUrl, runtime.queuePrefix, execution.id);
  } catch (error) {
    console.error(error instanceof Error ? error.name : "queue");
  }
  await publishExecution(runtime.redisUrl, execution.id);
  return getExecution(userId, execution.id);
}

export async function listExecutions(userId: string, agentId?: string) {
  const rows = await prisma.execution.findMany({
    where: { userId, ...(agentId ? { agentId } : {}) },
    include: { agent: { select: { name: true } }, agentVersion: { select: { versionNumber: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((row) => ({
    id: row.id,
    agentId: row.agentId,
    agentName: row.agent.name,
    versionNumber: row.agentVersion.versionNumber,
    task: row.task,
    status: row.status,
    errorCode: row.errorCode,
    errorMessage: safeErrorMessage(row.errorCode),
    estimatedCostUsd: row.estimatedCostUsd,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }));
}

export async function getExecution(userId: string, executionId: string) {
  const row = await prisma.execution.findFirst({
    where: { id: executionId, userId },
    include: {
      agent: { select: { name: true } },
      agentVersion: true,
      steps: { orderBy: { stepIndex: "asc" } },
      approvals: { orderBy: { createdAt: "asc" } },
      user: { select: { email: true } },
    },
  });
  if (!row) throw new NotFoundError();
  const snapshot = readAgentSnapshot(row.agentVersion);
  return {
    id: row.id,
    agentId: row.agentId,
    agentName: row.agent.name,
    agentVersionId: row.agentVersionId,
    versionNumber: snapshot.versionNumber,
    task: row.task,
    status: row.status,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    fencingToken: row.fencingToken,
    budgetReservedTokens: row.budgetReservedTokens,
    budgetHoldStatus: row.budgetHoldStatus,
    finalText: row.finalText,
    errorCode: row.errorCode,
    errorMessage: safeErrorMessage(row.errorCode),
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cachedTokens: row.cachedTokens,
    reasoningTokens: row.reasoningTokens,
    estimatedCostUsd: row.estimatedCostUsd,
    costIsEstimate: true,
    longContext: row.inputTokens > 272_000,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    steps: row.steps.map((step) => ({
      id: step.id,
      stepIndex: step.stepIndex,
      kind: step.kind,
      toolName: step.toolName,
      input: step.input,
      output: step.output,
      inputTokens: step.inputTokens,
      outputTokens: step.outputTokens,
      cachedTokens: step.cachedTokens,
      reasoningTokens: step.reasoningTokens,
      latencyMs: step.latencyMs,
      createdAt: step.createdAt.toISOString(),
    })),
    approvals: row.approvals.map((approval) => ({
      id: approval.id,
      toolName: approval.toolName,
      proposedInput: approval.proposedInput,
      status: approval.status,
      comment: approval.comment,
      decidedBy: approval.decidedByUserId ? row.user.email : null,
      decidedAt: approval.decidedAt?.toISOString() ?? null,
      expiresAt: approval.expiresAt.toISOString(),
      createdAt: approval.createdAt.toISOString(),
    })),
  };
}

export async function cancelExecution(userId: string, executionId: string, runtime: ExecutionRuntime) {
  const existing = await prisma.execution.findFirst({ where: { id: executionId, userId } });
  if (!existing) throw new NotFoundError();
  if (existing.status === "queued" && !existing.leaseOwner) {
    await prisma.execution.update({
      where: { id: existing.id },
      data: { status: "cancelled", errorCode: "cancelled", finishedAt: new Date(), cancelRequestedAt: new Date() },
    });
  } else if (existing.status === "waitingApproval") {
    await prisma.$transaction(async (tx) => {
      await tx.execution.updateMany({
        where: { id: existing.id, userId, status: "waitingApproval" },
        data: {
          status: "cancelled",
          errorCode: "cancelled",
          finishedAt: new Date(),
          cancelRequestedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      await tx.approval.updateMany({
        where: { executionId: existing.id, status: "pending" },
        data: {
          status: "rejected",
          comment: "Cancelled with the run",
          decidedByUserId: userId,
          decidedAt: new Date(),
        },
      });
    });
  } else if (existing.status === "running") {
    await prisma.execution.updateMany({
      where: { id: existing.id, userId, status: "running" },
      data: { cancelRequestedAt: new Date() },
    });
  }
  await publishExecution(runtime.redisUrl, executionId);
  return getExecution(userId, executionId);
}

export async function listApprovals(userId: string) {
  const rows = await prisma.approval.findMany({
    where: { userId },
    include: { execution: { select: { task: true, agent: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((row) => ({
    id: row.id,
    executionId: row.executionId,
    agentName: row.execution.agent.name,
    task: row.execution.task,
    toolName: row.toolName,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));
}

export async function getApproval(userId: string, approvalId: string) {
  const row = await prisma.approval.findFirst({
    where: { id: approvalId, userId },
    include: {
      execution: { select: { id: true, task: true, status: true, agent: { select: { name: true } } } },
      user: { select: { email: true } },
    },
  });
  if (!row) throw new NotFoundError();
  return {
    id: row.id,
    executionId: row.executionId,
    executionStatus: row.execution.status,
    agentName: row.execution.agent.name,
    task: row.execution.task,
    toolName: row.toolName,
    proposedInput: row.proposedInput,
    status: row.status,
    comment: row.comment,
    decidedBy: row.decidedByUserId ? row.user.email : null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function submitApprovalDecision(input: {
  userId: string;
  approvalId: string;
  decision: unknown;
  comment: unknown;
  runtime: ExecutionRuntime;
}) {
  if (input.decision !== "approved" && input.decision !== "rejected") {
    throw new ValidationError([{ path: "decision", message: "Decision must be approved or rejected" }]);
  }
  await decideApproval({
    userId: input.userId,
    approvalId: input.approvalId,
    decision: input.decision,
    comment: typeof input.comment === "string" ? input.comment : "",
    redisUrl: input.runtime.redisUrl,
    queuePrefix: input.runtime.queuePrefix,
  });
  return getApproval(input.userId, input.approvalId);
}
