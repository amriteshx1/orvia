import { prisma } from "@orvia/db";

export type MemoryHit = {
  id: string;
  content: string;
  kind: string;
  score: number;
};

export type MemoryRecord = {
  id: string;
  agentId: string;
  content: string;
  kind: string;
  status: "proposed" | "accepted" | "rejected";
  createdBy: "agent" | "user";
  sourceExecutionId: string | null;
  sourceStepId: string | null;
  toolCallId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type SaveInput = {
  userId: string;
  agentId: string;
  content: string;
  kind?: string;
  status: "proposed" | "accepted";
  createdBy: "agent" | "user";
  sourceExecutionId?: string | null;
  sourceStepId?: string | null;
  toolCallId?: string | null;
  embedding: number[];
};

export async function searchMemories(input: {
  userId: string;
  agentId: string;
  embedding: number[];
  limit: number;
}): Promise<MemoryHit[]> {
  const vector = toVector(input.embedding);
  const rows = await prisma.$queryRaw<Array<{ id: string; content: string; kind: string; score: number }>>`
    SELECT id, content, kind, 1 - (embedding <=> CAST(${vector} AS vector)) AS score
    FROM memory_item
    WHERE "userId" = ${input.userId}
      AND "agentId" = CAST(${input.agentId} AS uuid)
      AND status = 'accepted'::"MemoryStatus"
      AND "deletedAt" IS NULL
      AND embedding IS NOT NULL
    ORDER BY embedding <=> CAST(${vector} AS vector)
    LIMIT ${input.limit}
  `;
  return rows.map((row) => ({ ...row, score: Number(row.score) }));
}

export async function saveMemory(input: SaveInput): Promise<MemoryRecord> {
  if (input.toolCallId) {
    const existing = await prisma.memoryItem.findUnique({ where: { toolCallId: input.toolCallId } });
    if (existing) {
      if (existing.userId !== input.userId || existing.agentId !== input.agentId) {
        throw new Error("memory_conflict");
      }
      return toRecord(existing);
    }
  }
  const created = await prisma.memoryItem.create({
    data: {
      userId: input.userId,
      agentId: input.agentId,
      content: input.content,
      kind: input.kind ?? "fact",
      status: input.status,
      createdBy: input.createdBy,
      sourceExecutionId: input.sourceExecutionId ?? null,
      sourceStepId: input.sourceStepId ?? null,
      toolCallId: input.toolCallId ?? null,
    },
  });
  await writeEmbedding(created.id, input.userId, input.embedding);
  return toRecord(created);
}

export async function updateMemory(input: {
  userId: string;
  agentId: string;
  memoryId: string;
  content: string;
  embedding: number[];
  createdBy: "agent" | "user";
}): Promise<MemoryRecord | null> {
  const existing = await prisma.memoryItem.findFirst({
    where: { id: input.memoryId, userId: input.userId, agentId: input.agentId, deletedAt: null },
  });
  if (!existing) return null;
  const updated = await prisma.memoryItem.update({
    where: { id: existing.id },
    data: { content: input.content, createdBy: input.createdBy },
  });
  await writeEmbedding(updated.id, input.userId, input.embedding);
  return toRecord(updated);
}

export async function deleteMemory(input: {
  userId: string;
  agentId: string;
  memoryId: string;
}): Promise<boolean> {
  const updated = await prisma.memoryItem.updateMany({
    where: { id: input.memoryId, userId: input.userId, agentId: input.agentId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return updated.count === 1;
}

export async function setMemoryStatus(input: {
  userId: string;
  memoryId: string;
  status: "accepted" | "rejected";
}): Promise<MemoryRecord | null> {
  const existing = await prisma.memoryItem.findFirst({
    where: { id: input.memoryId, userId: input.userId, deletedAt: null },
  });
  if (!existing) return null;
  const updated = await prisma.memoryItem.update({
    where: { id: existing.id },
    data: { status: input.status },
  });
  return toRecord(updated);
}

export async function editMemoryByUser(input: {
  userId: string;
  memoryId: string;
  content: string;
  embedding: number[];
}): Promise<MemoryRecord | null> {
  const existing = await prisma.memoryItem.findFirst({
    where: { id: input.memoryId, userId: input.userId, deletedAt: null },
  });
  if (!existing) return null;
  const updated = await prisma.memoryItem.update({
    where: { id: existing.id },
    data: { content: input.content, createdBy: "user", embeddingHoldTokens: 0 },
  });
  await writeEmbedding(updated.id, input.userId, input.embedding);
  return toRecord(updated);
}

export async function listMemories(userId: string, agentId?: string): Promise<MemoryRecord[]> {
  const rows = await prisma.memoryItem.findMany({
    where: { userId, deletedAt: null, ...(agentId ? { agentId } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return rows.map(toRecord);
}

export async function getMemory(userId: string, memoryId: string): Promise<MemoryRecord | null> {
  const row = await prisma.memoryItem.findFirst({ where: { id: memoryId, userId, deletedAt: null } });
  return row ? toRecord(row) : null;
}

async function writeEmbedding(id: string, userId: string, embedding: number[]) {
  const vector = toVector(embedding);
  await prisma.$executeRaw`
    UPDATE memory_item
    SET embedding = CAST(${vector} AS vector), "updatedAt" = NOW()
    WHERE id = CAST(${id} AS uuid) AND "userId" = ${userId}
  `;
}

function toVector(values: number[]): string {
  return `[${values.map((value) => (Number.isFinite(value) ? value : 0)).join(",")}]`;
}

function toRecord(row: {
  id: string;
  agentId: string;
  content: string;
  kind: string;
  status: MemoryRecord["status"];
  createdBy: MemoryRecord["createdBy"];
  sourceExecutionId: string | null;
  sourceStepId: string | null;
  toolCallId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): MemoryRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    content: row.content,
    kind: row.kind,
    status: row.status,
    createdBy: row.createdBy,
    sourceExecutionId: row.sourceExecutionId,
    sourceStepId: row.sourceStepId,
    toolCallId: row.toolCallId,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
