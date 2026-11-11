import { Prisma, prisma } from "@orvia/db";
import { LEASE_TTL_MS } from "./constants";
import { LOST } from "./errors";

export type Tx = Prisma.TransactionClient;

export type Fence = {
  executionId: string;
  owner: string;
  token: number;
};

export function leaseExpiry(now = new Date()): Date {
  return new Date(now.getTime() + LEASE_TTL_MS);
}

export async function withFence<T>(fence: Fence, fn: (tx: Tx) => Promise<T>): Promise<T | typeof LOST> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM execution
      WHERE id = CAST(${fence.executionId} AS uuid)
        AND "leaseOwner" = ${fence.owner}
        AND "fencingToken" = ${fence.token}
        AND "leaseExpiresAt" > NOW()
      FOR UPDATE
    `;
    if (locked.length !== 1) return LOST;
    return fn(tx);
  });
}

export async function acquireLease(input: {
  executionId: string;
  owner: string;
  kind: "run" | "resume";
}): Promise<{ outcome: "acquired"; token: number } | { outcome: "busy" } | { outcome: "skip" }> {
  const now = new Date();
  const expires = leaseExpiry(now);
  const statuses =
    input.kind === "resume"
      ? ["waitingApproval", "running"]
      : ["queued", "running"];
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ fencingToken: number }>>`
      UPDATE execution
      SET
        status = 'running'::"ExecutionStatus",
        "leaseOwner" = ${input.owner},
        "leaseExpiresAt" = ${expires},
        "fencingToken" = "fencingToken" + 1,
        "heartbeatAt" = ${now},
        "startedAt" = COALESCE("startedAt", ${now}),
        "unresolvedHoldTokens" = "unresolvedHoldTokens" + "openHoldTokens",
        "openHoldTokens" = 0,
        "budgetReservedTokens" = "unresolvedHoldTokens" + "openHoldTokens",
        "budgetHoldStatus" = CASE
          WHEN ("unresolvedHoldTokens" + "openHoldTokens") > 0 THEN 'unresolved'::"BudgetHoldStatus"
          ELSE 'none'::"BudgetHoldStatus"
        END,
        "updatedAt" = ${now}
      WHERE id = CAST(${input.executionId} AS uuid)
        AND status::text = ANY(${statuses})
        AND ("leaseOwner" IS NULL OR "leaseExpiresAt" IS NULL OR "leaseExpiresAt" < ${now})
      RETURNING "fencingToken"
    `;
    const token = rows[0]?.fencingToken;
    if (!token) {
      const current = await tx.execution.findUnique({
        where: { id: input.executionId },
        select: { status: true, leaseExpiresAt: true },
      });
      if (!current) return { outcome: "skip" };
      if (current.status === "queued" || current.status === "running" || current.status === "waitingApproval") {
        return { outcome: "busy" };
      }
      return { outcome: "skip" };
    }
    await tx.externalEffect.updateMany({
      where: { executionId: input.executionId, status: "reserved" },
      data: { status: "uncertain" },
    });
    return { outcome: "acquired", token };
  });
}

export async function heartbeatLease(fence: Fence): Promise<"ok" | "cancel" | "lost"> {
  const now = new Date();
  const updated = await prisma.execution.updateMany({
    where: {
      id: fence.executionId,
      leaseOwner: fence.owner,
      fencingToken: fence.token,
      leaseExpiresAt: { gt: now },
      status: "running",
      cancelRequestedAt: null,
    },
    data: { leaseExpiresAt: leaseExpiry(now), heartbeatAt: now },
  });
  if (updated.count === 1) return "ok";
  const row = await prisma.execution.findUnique({
    where: { id: fence.executionId },
    select: { cancelRequestedAt: true, leaseOwner: true, fencingToken: true, leaseExpiresAt: true, status: true },
  });
  if (
    row?.status === "running" &&
    row.cancelRequestedAt &&
    row.leaseOwner === fence.owner &&
    row.fencingToken === fence.token &&
    row.leaseExpiresAt &&
    row.leaseExpiresAt > now
  ) {
    return "cancel";
  }
  return "lost";
}

export async function releaseLease(fence: Fence): Promise<boolean> {
  const updated = await prisma.execution.updateMany({
    where: {
      id: fence.executionId,
      leaseOwner: fence.owner,
      fencingToken: fence.token,
      leaseExpiresAt: { gt: new Date() },
      status: "running",
    },
    data: { leaseOwner: null, leaseExpiresAt: null },
  });
  return updated.count === 1;
}

export async function leaseHeld(fence: Fence): Promise<boolean> {
  const count = await prisma.execution.count({
    where: {
      id: fence.executionId,
      leaseOwner: fence.owner,
      fencingToken: fence.token,
      leaseExpiresAt: { gt: new Date() },
      status: "running",
    },
  });
  return count === 1;
}
