import { createHash } from "node:crypto";
import { prisma } from "@orvia/db";
import { redact } from "../redact";
import { safeErrorMessage } from "./constants";
import { EffectFailed, EffectRetry, EffectUncertain, LeaseLost, LOST } from "./errors";
import { leaseHeld, withFence, type Fence } from "./lease";
import { asJson, writeStep } from "./records";

export async function dispatchEffect<T>(input: {
  fence: Fence;
  toolCallId: string;
  toolName: string;
  input: unknown;
  idempotencyKey?: string | null;
  signal?: AbortSignal;
  perform: (context: { idempotencyKey: string | null }) => Promise<T>;
}): Promise<T> {
  const key = input.idempotencyKey ?? null;
  const existing = await prisma.externalEffect.findUnique({ where: { toolCallId: input.toolCallId } });
  if (existing) {
    if (existing.executionId !== input.fence.executionId) throw new EffectFailed();
    if (existing.status === "succeeded") return existing.result as T;
    if (existing.status === "failed") throw new EffectFailed();
    if (!existing.idempotencyKey) {
      if (existing.status === "reserved") await markUncertain(input.fence, input.toolCallId, input.toolName, input.input);
      throw new EffectUncertain();
    }
    return performAndStore(input, existing.idempotencyKey);
  }

  const hash = createHash("sha256")
    .update(JSON.stringify({ toolName: input.toolName, input: input.input }))
    .digest("hex");
  try {
    const inserted = await withFence(input.fence, async (tx) => {
      await tx.externalEffect.create({
        data: {
          executionId: input.fence.executionId,
          toolCallId: input.toolCallId,
          idempotencyKey: key,
          status: "reserved",
          requestHash: hash,
        },
      });
    });
    if (inserted === LOST) throw new LeaseLost();
  } catch (error) {
    if (error instanceof LeaseLost) throw error;
    if (!isUnique(error)) throw error;
    return dispatchEffect(input);
  }

  return performAndStore(input, key);
}

async function performAndStore<T>(
  input: {
    fence: Fence;
    toolCallId: string;
    toolName: string;
    input: unknown;
    signal?: AbortSignal;
    perform: (context: { idempotencyKey: string | null }) => Promise<T>;
  },
  idempotencyKey: string | null,
): Promise<T> {
  if (input.signal?.aborted || !(await leaseHeld(input.fence))) throw new LeaseLost();
  let result: T;
  try {
    result = await input.perform({ idempotencyKey });
  } catch (error) {
    if (error instanceof LeaseLost) throw error;
    if (error instanceof EffectFailed) {
      await markFailed(input.fence, input.toolCallId, input.toolName, input.input);
      throw error;
    }
    if (idempotencyKey) throw new EffectRetry();
    await markUncertain(input.fence, input.toolCallId, input.toolName, input.input);
    throw new EffectUncertain();
  }

  const stored = redact(result);
  const marked = await withFence(input.fence, async (tx) => {
    const updated = await tx.externalEffect.updateMany({
      where: {
        toolCallId: input.toolCallId,
        executionId: input.fence.executionId,
        status: { in: ["reserved", "uncertain"] },
      },
      data: { status: "succeeded", result: asJson(stored) },
    });
    if (updated.count !== 1) throw new EffectUncertain();
    await writeStep(tx, {
      executionId: input.fence.executionId,
      kind: "tool",
      toolName: input.toolName,
      input: redact(input.input),
      output: stored,
    });
  });
  if (marked === LOST) throw new LeaseLost();
  return result;
}

async function markUncertain(fence: Fence, toolCallId: string, toolName: string, input: unknown) {
  await withFence(fence, async (tx) => {
    const updated = await tx.externalEffect.updateMany({
      where: { toolCallId, executionId: fence.executionId, status: "reserved" },
      data: { status: "uncertain" },
    });
    if (updated.count !== 1) return;
    await writeStep(tx, {
      executionId: fence.executionId,
      kind: "tool",
      toolName,
      input: redact(input),
      output: { status: "uncertain", message: safeErrorMessage("effect_uncertain") },
    });
  });
}

async function markFailed(fence: Fence, toolCallId: string, toolName: string, input: unknown) {
  await withFence(fence, async (tx) => {
    await tx.externalEffect.updateMany({
      where: { toolCallId, executionId: fence.executionId, status: { in: ["reserved", "uncertain"] } },
      data: { status: "failed", result: asJson({ error: "effect_failed" }) },
    });
    await writeStep(tx, {
      executionId: fence.executionId,
      kind: "tool",
      toolName,
      input: redact(input),
      output: { error: "effect_failed", message: safeErrorMessage("effect_failed") },
    });
  });
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function recordToolStep(fence: Fence, toolName: string, input: unknown, output: unknown): Promise<void> {
  const saved = await withFence(fence, (tx) =>
    writeStep(tx, {
      executionId: fence.executionId,
      kind: "tool",
      toolName,
      input: redact(input),
      output: redact(output),
    }),
  );
  if (saved === LOST) throw new LeaseLost();
}
