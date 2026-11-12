import { prisma } from "@orvia/db";
import {
  addUsage,
  budgetTokens,
  emptyUsage,
  estimateRunCostUsd,
  type TokenUsage,
} from "../pricing";
import { BudgetStopped, LeaseLost, LOST } from "./errors";
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
      execution.inputTokens +
      execution.outputTokens +
      execution.cachedTokens +
      execution.reasoningTokens +
      execution.embeddingTokens;
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

function costFor(
  execution: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    reasoningTokens: number;
    embeddingTokens: number;
    webSearchCalls: number;
  },
  chatModel: string,
  embeddingModel: string,
) {
  return estimateRunCostUsd({
    model: chatModel,
    usage: {
      inputTokens: execution.inputTokens,
      outputTokens: execution.outputTokens,
      cachedTokens: execution.cachedTokens,
      reasoningTokens: execution.reasoningTokens,
    },
    embeddingModel,
    embeddingTokens: execution.embeddingTokens,
    webSearchCalls: execution.webSearchCalls,
  });
}

export async function reconcileUsage(input: {
  fence: Fence;
  userId: string;
  model: string;
  embeddingModel: string;
  usage: TokenUsage;
  webSearchDelta?: number;
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
    const webSearchCalls = execution.webSearchCalls + (input.webSearchDelta ?? 0);
    const toolCalls = await tx.executionStep.count({
      where: { executionId: execution.id, kind: "tool" },
    });
    const cost = estimateRunCostUsd({
      model: input.model,
      usage: totals,
      embeddingModel: input.embeddingModel,
      embeddingTokens: execution.embeddingTokens,
      webSearchCalls,
    });
    await tx.execution.update({
      where: { id: execution.id },
      data: {
        ...holdData(0, execution.unresolvedHoldTokens),
        ...totals,
        webSearchCalls,
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
        embeddingTokens: execution.embeddingTokens,
        webSearchCalls,
        estimatedCostUsd: cost,
      },
      update: {
        ...totals,
        toolCallCount: toolCalls,
        embeddingTokens: execution.embeddingTokens,
        webSearchCalls,
        estimatedCostUsd: cost,
      },
    });
  });
}

export async function reconcileEmbedding(input: {
  fence: Fence;
  userId: string;
  model: string;
  embeddingModel: string;
  tokens: number;
}): Promise<void | typeof LOST> {
  return withFence(input.fence, async (tx) => {
    const execution = await tx.execution.findUniqueOrThrow({ where: { id: input.fence.executionId } });
    await releaseReserved(tx, input.userId, execution.openHoldTokens);
    await tx.$executeRaw`
      UPDATE user_budget
      SET "consumedTokens" = "consumedTokens" + ${input.tokens}, "updatedAt" = NOW()
      WHERE "userId" = ${input.userId}
    `;
    const embeddingTokens = execution.embeddingTokens + input.tokens;
    const next = { ...execution, embeddingTokens, openHoldTokens: 0 };
    const cost = costFor(next, input.model, input.embeddingModel);
    await tx.execution.update({
      where: { id: execution.id },
      data: { ...holdData(0, execution.unresolvedHoldTokens), embeddingTokens, estimatedCostUsd: cost },
    });
    await tx.usageRecord.updateMany({
      where: { executionId: execution.id },
      data: { embeddingTokens, estimatedCostUsd: cost },
    });
  });
}

export async function chargeKnownUsage(input: {
  userId: string;
  tokens: number;
  caps: BudgetCaps;
  releaseReserved?: number;
}): Promise<"charged" | "budget_exceeded"> {
  return prisma.$transaction(async (tx) => {
    const budget = await lockBudget(tx, input.userId, input.caps);
    const release = input.releaseReserved ?? 0;
    const projected = budget.consumedTokens + budget.reservedTokens - release + input.tokens;
    if (projected > budget.monthlyTokenCap) return "budget_exceeded";
    await releaseReserved(tx, input.userId, release);
    if (input.tokens > 0) {
      await tx.$executeRaw`
        UPDATE user_budget
        SET "consumedTokens" = "consumedTokens" + ${input.tokens}, "updatedAt" = NOW()
        WHERE "userId" = ${input.userId}
      `;
    }
    return "charged";
  });
}

export async function holdUnresolvedDirect(userId: string, tokens: number, caps: BudgetCaps): Promise<void> {
  if (tokens <= 0) return;
  await prisma.$transaction(async (tx) => {
    await lockBudget(tx, userId, caps);
    await addReserved(tx, userId, tokens);
  });
}

export async function withPaidCall<T>(input: {
  fence: Fence;
  userId: string;
  estimate: number;
  executionCap: number;
  caps: BudgetCaps;
  model: string;
  embeddingModel: string;
  run: (markSent: () => void) => Promise<{
    value: T;
    usage: TokenUsage | null;
    usageKnown: boolean;
    webSearchDelta?: number;
    embeddingTokens?: number;
  }>;
}): Promise<T> {
  const reserved = await reserveCall({
    fence: input.fence,
    userId: input.userId,
    estimate: input.estimate,
    executionCap: input.executionCap,
    caps: input.caps,
  });
  if (reserved === LOST) throw new LeaseLost();
  if (reserved === "budget_exceeded") throw new BudgetStopped();
  let sent = false;
  try {
    const outcome = await input.run(() => {
      sent = true;
    });
    if (!outcome.usageKnown) {
      const settled = sent ? await markHoldUnresolved(input.fence) : await releaseOpenHold(input.fence, input.userId);
      if (settled === LOST) throw new LeaseLost();
    } else if (outcome.embeddingTokens !== undefined) {
      const reconciled = await reconcileEmbedding({
        fence: input.fence,
        userId: input.userId,
        model: input.model,
        embeddingModel: input.embeddingModel,
        tokens: outcome.embeddingTokens,
      });
      if (reconciled === LOST) throw new LeaseLost();
    } else if (outcome.usage) {
      const reconciled = await reconcileUsage({
        fence: input.fence,
        userId: input.userId,
        model: input.model,
        embeddingModel: input.embeddingModel,
        usage: outcome.usage,
        webSearchDelta: outcome.webSearchDelta,
      });
      if (reconciled === LOST) throw new LeaseLost();
    } else {
      const released = await releaseOpenHold(input.fence, input.userId);
      if (released === LOST) throw new LeaseLost();
    }
    return outcome.value;
  } catch (error) {
    if (error instanceof LeaseLost || error instanceof BudgetStopped) throw error;
    if (sent) await markHoldUnresolved(input.fence);
    else await releaseOpenHold(input.fence, input.userId);
    throw error;
  }
}

export async function activeExecutionCount(userId: string): Promise<number> {
  return prisma.execution.count({
    where: { userId, status: { in: ["queued", "running", "waitingApproval"] } },
  });
}

export { emptyUsage };
