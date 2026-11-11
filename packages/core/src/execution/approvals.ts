import { prisma } from "@orvia/db";
import { NotFoundError, ValidationError } from "../agents/schema";
import type { Tx } from "./lease";
import { publishExecution } from "./publish";
import { enqueueResume } from "./queue";

export async function expireApprovals(redisUrl: string): Promise<void> {
  const due = await prisma.approval.findMany({
    where: { status: "pending", expiresAt: { lt: new Date() } },
    take: 50,
  });
  for (const approval of due) {
    const changed = await prisma.$transaction(async (tx) => {
      const updated = await tx.approval.updateMany({
        where: { id: approval.id, status: "pending", expiresAt: { lt: new Date() } },
        data: { status: "expired" },
      });
      if (updated.count !== 1) return false;
      const pending = await tx.approval.count({
        where: { executionId: approval.executionId, status: "pending" },
      });
      if (pending > 0) return true;
      await tx.execution.updateMany({
        where: { id: approval.executionId, status: "waitingApproval" },
        data: {
          status: "failed",
          errorCode: "approval_expired",
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      await tx.executionStep.create({
        data: {
          executionId: approval.executionId,
          stepIndex: await nextStep(tx, approval.executionId),
          kind: "approval",
          toolName: approval.toolName,
          output: { outcome: "expired" },
        },
      });
      return true;
    });
    if (changed) await publishExecution(redisUrl, approval.executionId);
  }
}

export async function decideApproval(input: {
  userId: string;
  approvalId: string;
  decision: "approved" | "rejected";
  comment: string;
  redisUrl: string;
  queuePrefix: string;
}) {
  const comment = input.comment.trim();
  if (input.decision === "rejected" && comment.length === 0) {
    throw new ValidationError([{ path: "comment", message: "A rejection reason is required" }]);
  }
  if (comment.length > 2_000) {
    throw new ValidationError([{ path: "comment", message: "Comment is too long" }]);
  }

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.approval.findFirst({ where: { id: input.approvalId, userId: input.userId } });
    if (!existing) throw new NotFoundError();
    await tx.$queryRaw`SELECT id FROM execution WHERE id = CAST(${existing.executionId} AS uuid) FOR UPDATE`;
    const approval = await tx.approval.findFirst({ where: { id: existing.id, userId: input.userId } });
    if (!approval) throw new NotFoundError();
    if (approval.status !== "pending") return { approval, enqueue: false as const, stepIndex: 0 };

    if (approval.expiresAt.getTime() <= Date.now()) {
      await tx.approval.update({ where: { id: approval.id }, data: { status: "expired" } });
      await tx.execution.updateMany({
        where: { id: approval.executionId, userId: input.userId, status: "waitingApproval" },
        data: {
          status: "failed",
          errorCode: "approval_expired",
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      return { approval: { ...approval, status: "expired" as const }, enqueue: false as const, stepIndex: 0 };
    }

    const execution = await tx.execution.findFirst({
      where: { id: approval.executionId, userId: input.userId, status: "waitingApproval" },
    });
    if (!execution) throw new NotFoundError();
    const saved = await tx.approval.update({
      where: { id: approval.id },
      data: {
        status: input.decision,
        comment: comment || null,
        decidedByUserId: input.userId,
        decidedAt: new Date(),
      },
    });
    const pending = await tx.approval.count({
      where: { executionId: execution.id, status: "pending" },
    });
    const checkpoint = await tx.executionCheckpoint.findFirst({
      where: { executionId: execution.id },
      orderBy: { stepIndex: "desc" },
      select: { stepIndex: true },
    });
    return {
      approval: saved,
      enqueue: pending === 0,
      stepIndex: checkpoint?.stepIndex ?? 0,
      executionId: execution.id,
    };
  });

  if (result.enqueue && "executionId" in result && result.executionId) {
    await enqueueResume(input.redisUrl, input.queuePrefix, result.executionId, result.stepIndex);
  }
  await publishExecution(input.redisUrl, result.approval.executionId);
  return result.approval;
}

async function nextStep(tx: Tx, executionId: string) {
  const last = await tx.executionStep.aggregate({
    where: { executionId },
    _max: { stepIndex: true },
  });
  return (last._max.stepIndex ?? -1) + 1;
}
