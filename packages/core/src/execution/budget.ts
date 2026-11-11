import { prisma } from "@orvia/db";
import {
  addUsage,
  budgetTokens,
  emptyUsage,
  estimateCostUsd,
  type TokenUsage,
} from "../pricing";
import { LOST } from "./errors";
import { leaseExpiry, withFence, type Fence, type Tx } from "./lease";

export type BudgetCaps = {
  monthlyTokenCap: number;
  concurrentRunCap: number;
};

export function currentPeriodStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function ensureBudget(tx: Tx, userId: string, caps: BudgetCaps) {
  await tx.userBudget.upsert({
    where: { userId },
    create: {
      userId,
      monthlyTokenCap: caps.monthlyTokenCap,
      concurrentRunCap: caps.concurrentRunCap,
      consumedTokens: 0,
      reservedTokens: 0,
      periodStart: currentPeriodStart(),
    },
    update: {},
  });
}

async function lockBudget(tx: Tx, userId: string, caps: BudgetCaps) {
  await ensureBudget(tx, userId, caps);
  await tx.$queryRaw`SELECT "userId" FROM user_budget WHERE "userId" = ${userId} FOR UPDATE`;
  const budget = await tx.userBudget.findUniqueOrThrow({ where: { userId } });
  const period = currentPeriodStart();
  if (budget.periodStart < period) {
    return tx.userBudget.update({
      where: { userId },
      data: { consumedTokens: 0, periodStart: period },
    });
  }
  return budget;
}

function holdData(open: number, unresolved: number) {
  const reserved = open + unresolved;
  return {
    openHoldTokens: open,
    unresolvedHoldTokens: unresolved,
    budgetReservedTokens: reserved,
    budgetHoldStatus: open > 0 ? ("open" as const) : unresolved > 0 ? ("unresolved" as const) : ("none" as const),
  };
}

async function addReserved(tx: Tx, userId: string, tokens: number) {
  if (tokens === 0) return;
  await tx.$executeRaw`
    UPDATE user_budget
    SET "reservedTokens" = "reservedTokens" + ${tokens}, "updatedAt" = NOW()
    WHERE "userId" = ${userId}
  `;
}

async function releaseReserved(tx: Tx, userId: string, tokens: number) {
  if (tokens <= 0) return;
  await tx.$executeRaw`
    UPDATE user_budget
    SET "reservedTokens" = GREATEST(0, "reservedTokens" - ${tokens}), "updatedAt" = NOW()
    WHERE "userId" = ${userId}
  `;
}

export async function reserveCall(input: {
  fence: Fence;
  userId: string;
  estimate: number;
  executionCap: number;
  caps: BudgetCaps;
}): Promise<"reserved" | "budget_exceeded" | typeof LOST> {
  return withFence(input.fence, async (tx) => {
    const execution = await tx.execution.findUniqueOrThrow({ where: { id: input.fence.executionId } });
    const budget = await lockBudget(tx, input.userId, input.caps);
    let unresolved = execution.unresolvedHoldTokens;
    let open = execution.openHoldTokens;
    if (open > 0) {
      unresolved += open;
      open = 0;
    }
    const spent =
      execution.inputTokens + execution.outputTokens + execution.cachedTokens + execution.reasoningTokens;
    const monthly = budget.consumedTokens + budget.reservedTokens + input.estimate;
    const run = spent + unresolved + open + input.estimate;
    if (monthly > budget.monthlyTokenCap || run > input.executionCap) {
      await tx.execution.update({
        where: { id: execution.id },
        data: {
          ...holdData(0, unresolved),
          status: "budgetExceeded",
          errorCode: "budget_exceeded",
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      return "budget_exceeded" as const;
    }
    await addReserved(tx, input.userId, input.estimate);
    await tx.execution.update({
      where: { id: execution.id },
      data: {
        ...holdData(open + input.estimate, unresolved),
        leaseExpiresAt: leaseExpiry(),
        heartbeatAt: new Date(),
      },
    });
    return "reserved" as const;
  });
}

export async function releaseOpenHold(fence: Fence, userId: string): Promise<void | typeof LOST> {
  return withFence(fence, async (tx) => {
    const execution = await tx.execution.findUniqueOrThrow({ where: { id: fence.executionId } });
    await releaseReserved(tx, userId, execution.openHoldTokens);
    await tx.execution.update({
      where: { id: execution.id },
      data: holdData(0, execution.unresolvedHoldTokens),
    });
  });
}

export async function markHoldUnresolved(fence: Fence): Promise<void | typeof LOST> {
  return withFence(fence, async (tx) => {
    const execution = await tx.execution.findUniqueOrThrow({ where: { id: fence.executionId } });
    if (execution.openHoldTokens <= 0) return;
    await tx.execution.update({
      where: { id: execution.id },
      data: holdData(0, execution.unresolvedHoldTokens + execution.openHoldTokens),
    });
  });
}

export async function reconcileUsage(input: {
  fence: Fence;
  userId: string;
  model: string;
  usage: TokenUsage;
}): Promise<void | typeof LOST> {
  return withFence(input.fence, async (tx) => {
    const execution = await tx.execution.findUniqueOrThrow({ where: { id: input.fence.executionId } });
    const actual = budgetTokens(input.usage);
    await releaseReserved(tx, input.userId, execution.openHoldTokens);
    await tx.$executeRaw`
      UPDATE user_budget
      SET "consumedTokens" = "consumedTokens" + ${actual}, "updatedAt" = NOW()
      WHERE "userId" = ${input.userId}
    `;
    const totals = addUsage(
      {
        inputTokens: execution.inputTokens,
        outputTokens: execution.outputTokens,
        cachedTokens: execution.cachedTokens,
        reasoningTokens: execution.reasoningTokens,
      },
      input.usage,
    );
    const toolCalls = await tx.executionStep.count({
      where: { executionId: execution.id, kind: "tool" },
    });
    const cost = estimateCostUsd(input.model, totals);
    await tx.execution.update({
      where: { id: execution.id },
      data: {
        ...holdData(0, execution.unresolvedHoldTokens),
        ...totals,
        estimatedCostUsd: cost,
      },
    });
    await tx.usageRecord.upsert({
      where: { executionId: execution.id },
      create: {
        userId: input.userId,
        executionId: execution.id,
        ...totals,
        toolCallCount: toolCalls,
        estimatedCostUsd: cost,
      },
      update: { ...totals, toolCallCount: toolCalls, estimatedCostUsd: cost },
    });
  });
}

export async function activeExecutionCount(userId: string): Promise<number> {
  return prisma.execution.count({
    where: { userId, status: { in: ["queued", "running", "waitingApproval"] } },
  });
}

export { emptyUsage };
