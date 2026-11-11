import { createHash } from "node:crypto";
import { Prisma, prisma } from "@orvia/db";
import { redact } from "../redact";
import { EffectFailed, EffectUncertain, LeaseLost, LOST } from "./errors";
import { leaseHeld, withFence, type Fence } from "./lease";
import { writeStep } from "./records";

export async function dispatchEffect<T>(input: {
  fence: Fence;
  toolCallId: string;
  toolName: string;
  input: unknown;
  idempotencyKey?: string | null;
  signal?: AbortSignal;
  perform: () => Promise<T>;
}): Promise<T> {
  const existing = await prisma.externalEffect.findUnique({ where: { toolCallId: input.toolCallId } });
  if (existing) {
    if (existing.executionId !== input.fence.executionId) throw new EffectFailed();
    if (existing.status === "succeeded") return existing.result as T;
    if (existing.status === "failed") throw new EffectFailed();
    if (existing.status === "uncertain" || existing.status === "reserved") {
      if (existing.status === "reserved") await markUncertain(input.fence, input.toolCallId);
      throw new EffectUncertain();
    }
  }

  const hash = createHash("sha256")
    .update(JSON.stringify({ toolName: input.toolName, input: input.input }))
    .digest("hex");
  const inserted = await withFence(input.fence, async (tx) => {
    await tx.externalEffect.create({
      data: {
        executionId: input.fence.executionId,
        toolCallId: input.toolCallId,
        idempotencyKey: input.idempotencyKey ?? null,
        status: "reserved",
        requestHash: hash,
      },
    });
  });
  if (inserted === LOST) throw new LeaseLost();

  if (input.signal?.aborted || !(await leaseHeld(input.fence))) throw new LeaseLost();

  let result: T;
  try {
    result = await input.perform();
  } catch (error) {
    if (error instanceof LeaseLost) throw error;
    await markUncertain(input.fence, input.toolCallId);
    throw new EffectUncertain();
  }

  const stored = redact(result);
  const marked = await withFence(input.fence, async (tx) => {
    const updated = await tx.externalEffect.updateMany({
      where: { toolCallId: input.toolCallId, executionId: input.fence.executionId, status: "reserved" },
      data: { status: "succeeded", result: json(stored) },
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

async function markUncertain(fence: Fence, toolCallId: string) {
  await withFence(fence, async (tx) => {
    await tx.externalEffect.updateMany({
      where: { toolCallId, executionId: fence.executionId, status: "reserved" },
      data: { status: "uncertain" },
    });
  });
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
