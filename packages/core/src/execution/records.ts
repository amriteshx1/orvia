import { Prisma } from "@orvia/db";
import { CHECKPOINT_SCHEMA_VERSION } from "./constants";
import type { Tx } from "./lease";

export function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export async function writeCheckpoint(tx: Tx, executionId: string, messages: unknown): Promise<number> {
  const last = await tx.executionCheckpoint.aggregate({
    where: { executionId },
    _max: { stepIndex: true },
  });
  const stepIndex = (last._max.stepIndex ?? -1) + 1;
  await tx.executionCheckpoint.create({
    data: {
      executionId,
      stepIndex,
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      messages: asJson(messages),
    },
  });
  return stepIndex;
}

export async function writeStep(
  tx: Tx,
  input: {
    executionId: string;
    kind: string;
    toolName?: string | null;
    input?: unknown;
    output?: unknown;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      reasoningTokens: number;
    } | null;
    latencyMs?: number | null;
  },
): Promise<number> {
  const last = await tx.executionStep.aggregate({
    where: { executionId: input.executionId },
    _max: { stepIndex: true },
  });
  const stepIndex = (last._max.stepIndex ?? -1) + 1;
  await tx.executionStep.create({
    data: {
      executionId: input.executionId,
      stepIndex,
      kind: input.kind,
      toolName: input.toolName ?? null,
      input: input.input === undefined ? undefined : asJson(input.input),
      output: input.output === undefined ? undefined : asJson(input.output),
      inputTokens: input.usage?.inputTokens,
      outputTokens: input.usage?.outputTokens,
      cachedTokens: input.usage?.cachedTokens,
      reasoningTokens: input.usage?.reasoningTokens,
      latencyMs: input.latencyMs ?? null,
    },
  });
  return stepIndex;
}
