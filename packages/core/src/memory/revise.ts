import { prisma } from "@orvia/db";
import { ValidationError } from "../agents/schema";
import { chargeKnownUsage, holdUnresolvedDirect, type BudgetCaps } from "../execution/budget";
import { editMemoryByUser, getMemory, type MemoryRecord } from "./store";

export async function reviseUserMemory(input: {
  userId: string;
  memoryId: string;
  content: string;
  apiKey?: string;
  embeddingModel: string;
  caps: BudgetCaps;
}): Promise<MemoryRecord> {
  const content = input.content.trim();
  if (!content || content.length > 8_000) {
    throw new ValidationError([{ path: "content", message: "Enter memory text up to 8000 characters" }]);
  }
  const existing = await getMemory(input.userId, input.memoryId);
  if (!existing) throw new ValidationError([{ path: "memory", message: "Memory was not found" }]);
  const embedding = await embedForUser({
    userId: input.userId,
    memoryId: existing.id,
    content,
    apiKey: input.apiKey,
    model: input.embeddingModel,
    caps: input.caps,
  });
  const updated = await editMemoryByUser({
    userId: input.userId,
    memoryId: existing.id,
    content,
    embedding,
  });
  if (!updated) throw new ValidationError([{ path: "memory", message: "Memory was not found" }]);
  return updated;
}

async function embedForUser(input: {
  userId: string;
  memoryId: string;
  content: string;
  apiKey?: string;
  model: string;
  caps: BudgetCaps;
}): Promise<number[]> {
  if (!input.apiKey) {
    throw new ValidationError([{ path: "embedding", message: "OPENAI_API_KEY is not configured" }]);
  }
  const estimate = Math.max(1, Math.ceil(input.content.length / 4));
  let dispatched = false;
  try {
    dispatched = true;
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: input.model, input: input.content }),
    });
    const body = (await response.json().catch(() => null)) as {
      data?: Array<{ embedding?: number[] }>;
      usage?: { total_tokens?: number };
    } | null;
    const embedding = body?.data?.[0]?.embedding;
    const tokens = body?.usage?.total_tokens;
    if (!response.ok || !embedding || !embedding.length || typeof tokens !== "number") {
      throw new ValidationError([{ path: "embedding", message: "The embedding request failed" }]);
    }
    const charged = await chargeKnownUsage({ userId: input.userId, tokens, caps: input.caps });
    if (charged === "budget_exceeded") {
      throw new ValidationError([{ path: "budget", message: "The monthly token budget has been reached" }]);
    }
    return embedding;
  } catch (error) {
    if (dispatched && !(error instanceof ValidationError)) {
      await holdUnresolvedDirect(input.userId, estimate, input.caps);
      await prisma.memoryItem.updateMany({
        where: { id: input.memoryId, userId: input.userId },
        data: { embeddingHoldTokens: estimate },
      });
    }
    throw error;
  }
}
