import { withPaidCall } from "../execution/budget";
import { dispatchEffect, recordToolStep } from "../execution/effects";
import { BudgetStopped, EffectFailed, EffectRetry, LeaseLost } from "../execution/errors";
import { safeErrorMessage } from "../execution/constants";
import { deleteMemory, saveMemory, searchMemories, updateMemory } from "../memory/store";
import { hasEmbeddingPrice } from "../pricing";
import type { ToolCall, ToolRuntime } from "./runtime";
import { readRecord, text } from "./runtime";

export async function runMemorySearch(runtime: ToolRuntime, call: ToolCall) {
  const query = text(readRecord(call.input).query, 2_000);
  if (!query) return { ok: false, error: "invalid_input", message: "A query is required." };
  const embedding = await embedOrExplain(runtime, query, call.signal);
  if (!Array.isArray(embedding)) return embedding;
  const hits = await searchMemories({
    userId: runtime.userId,
    agentId: runtime.agentId,
    embedding,
    limit: 5,
  });
  const output = {
    ok: true,
    memories: hits.map((hit) => ({ id: hit.id, content: hit.content, kind: hit.kind, score: Number(hit.score.toFixed(4)) })),
  };
  await recordToolStep(runtime.fence, "memory_search", { query }, output);
  return output;
}

export async function runMemorySave(runtime: ToolRuntime, call: ToolCall) {
  const content = text(readRecord(call.input).content, 4_000);
  if (!content) return { ok: false, error: "invalid_input", message: "Memory content is required." };
  const embedding = await embedOrExplain(runtime, content, call.signal);
  if (!Array.isArray(embedding)) return embedding;
  const status = runtime.snapshot.memoryWriteMode === "auto" || runtime.snapshot.memoryWriteMode === "approval_pause" ? "accepted" : "proposed";
  const saved = await saveMemory({
    userId: runtime.userId,
    agentId: runtime.agentId,
    content,
    status,
    createdBy: "agent",
    sourceExecutionId: runtime.fence.executionId,
    toolCallId: call.toolCallId,
    embedding,
  });
  const output = {
    ok: true,
    id: saved.id,
    status: saved.status,
    message:
      saved.status === "proposed"
        ? "The memory was proposed and is not retrievable until the user accepts it."
        : "The memory was saved.",
  };
  await recordToolStep(runtime.fence, "memory_save", { content }, output);
  return output;
}

export async function runMemoryUpdate(runtime: ToolRuntime, call: ToolCall) {
  const body = readRecord(call.input);
  const memoryId = text(body.id, 80);
  const content = text(body.content, 4_000);
  if (!memoryId || !content) return { ok: false, error: "invalid_input", message: "A memory id and content are required." };
  try {
    return await dispatchEffect({
      fence: runtime.fence,
      toolCallId: call.toolCallId,
      toolName: "memory_update",
      input: { id: memoryId, content },
      idempotencyKey: null,
      signal: call.signal,
      perform: async () => {
        const embedding = await embed(runtime, content, call.signal);
        if (embedding.length === 0) throw new EffectFailed();
        const updated = await updateMemory({
          userId: runtime.userId,
          agentId: runtime.agentId,
          memoryId,
          content,
          embedding,
          createdBy: "agent",
        });
        if (!updated) throw new EffectFailed();
        return { ok: true, id: updated.id, status: updated.status };
      },
    });
  } catch (error) {
    if (error instanceof EffectFailed) return { ok: false, error: "effect_failed", message: safeErrorMessage("effect_failed") };
    throw error;
  }
}

export async function runMemoryDelete(runtime: ToolRuntime, call: ToolCall) {
  const memoryId = text(readRecord(call.input).id, 80);
  if (!memoryId) return { ok: false, error: "invalid_input", message: "A memory id is required." };
  try {
    return await dispatchEffect({
      fence: runtime.fence,
      toolCallId: call.toolCallId,
      toolName: "memory_delete",
      input: { id: memoryId },
      idempotencyKey: null,
      signal: call.signal,
      perform: async () => {
        const removed = await deleteMemory({ userId: runtime.userId, agentId: runtime.agentId, memoryId });
        if (!removed) throw new EffectFailed();
        return { ok: true, id: memoryId, deleted: true };
      },
    });
  } catch (error) {
    if (error instanceof EffectFailed) return { ok: false, error: "effect_failed", message: safeErrorMessage("effect_failed") };
    throw error;
  }
}

async function embedOrExplain(runtime: ToolRuntime, content: string, signal?: AbortSignal) {
  try {
    return await embed(runtime, content, signal);
  } catch (error) {
    if (error instanceof BudgetStopped || error instanceof LeaseLost || error instanceof EffectRetry) throw error;
    return { ok: false as const, error: "embedding_failed", message: "The memory could not be embedded." };
  }
}

async function embed(runtime: ToolRuntime, content: string, signal?: AbortSignal): Promise<number[]> {
  if (!runtime.openAiApiKey) throw new Error("openai_not_configured");
  if (!hasEmbeddingPrice(runtime.embeddingModel)) throw new Error("unpriced_model");
  const result = await withPaidCall({
    fence: runtime.fence,
    userId: runtime.userId,
    estimate: Math.max(1, Math.ceil(content.length / 4)),
    executionCap: runtime.snapshot.maxTotalTokens,
    caps: { monthlyTokenCap: runtime.monthlyTokenCap, concurrentRunCap: runtime.concurrentRunCap },
    model: runtime.snapshot.model,
    embeddingModel: runtime.embeddingModel,
    run: async (markSent) => {
      markSent();
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { authorization: `Bearer ${runtime.openAiApiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: runtime.embeddingModel, input: content }),
        signal,
      });
      const body = (await response.json().catch(() => ({}))) as {
        data?: Array<{ embedding?: number[] }>;
        usage?: { prompt_tokens?: number; total_tokens?: number };
      };
      const embedding = body.data?.[0]?.embedding;
      if (!response.ok || !embedding) {
        return { value: [] as number[], usage: null, usageKnown: true, embeddingTokens: 0 };
      }
      return {
        value: embedding,
        usage: null,
        usageKnown: true,
        embeddingTokens: body.usage?.prompt_tokens ?? body.usage?.total_tokens ?? 0,
      };
    },
  });
  if (result.length === 0) throw new EffectFailed();
  return result;
}
