import { prisma } from "@orvia/db";
import { normalizeApprovalPolicy, type AgentSnapshot } from "./defaults";
import { diffInstructions, diffSettings, type FieldChange, type InstructionChange } from "./diff";
import { NotFoundError, parseAgentInput, snapshotFromInput, ValidationError } from "./schema";

type VersionRecord = {
  id: string;
  versionNumber: number;
  name: string;
  description: string;
  instructions: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  toolConfig: unknown;
  memoryConfig: unknown;
  limits: unknown;
  approvalPolicy: unknown;
  createdAt: Date;
};

const versionInclude = {
  versions: { orderBy: { versionNumber: "desc" as const } },
};

export type AgentDetails = {
  id: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  current: AgentSnapshot & { id: string; versionNumber: number; createdAt: string };
  versions: Array<AgentSnapshot & { id: string; versionNumber: number; createdAt: string }>;
};

export async function listAgents(userId: string) {
  const agents = await prisma.agent.findMany({
    where: { userId, archivedAt: null },
    include: { currentVersion: true },
    orderBy: { updatedAt: "desc" },
  });
  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    description: agent.description,
    updatedAt: agent.updatedAt.toISOString(),
    model: agent.currentVersion?.model ?? "",
    versionNumber: agent.currentVersion?.versionNumber ?? 0,
  }));
}

export async function getAgent(userId: string, agentId: string): Promise<AgentDetails> {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, userId },
    include: versionInclude,
  });
  if (!agent) throw new NotFoundError();
  const versions = agent.versions.map(toVersion);
  const current = versions.find((version) => version.id === agent.currentVersionId) ?? versions[0];
  if (!current) throw new NotFoundError();
  return {
    id: agent.id,
    archivedAt: agent.archivedAt?.toISOString() ?? null,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
    current,
    versions,
  };
}

export async function createAgent(userId: string, value: unknown, model: string) {
  const snapshot = snapshotFromInput(parseAgentInput(value), model);
  const agent = await prisma.$transaction(async (tx) => {
    const created = await tx.agent.create({
      data: {
        userId,
        name: snapshot.name,
        description: snapshot.description,
      },
    });
    const version = await tx.agentVersion.create({
      data: versionData(created.id, 1, snapshot),
    });
    return tx.agent.update({
      where: { id: created.id },
      data: { currentVersionId: version.id },
    });
  });
  return getAgent(userId, agent.id);
}

export async function updateAgent(userId: string, agentId: string, value: unknown, model: string) {
  const snapshot = snapshotFromInput(parseAgentInput(value), model);
  const existing = await prisma.agent.findFirst({
    where: { id: agentId, userId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  if (!existing) throw new NotFoundError();
  if (existing.archivedAt) {
    throw new ValidationError([{ path: "agent", message: "Archived agents cannot be edited" }]);
  }
  const nextNumber = (existing.versions[0]?.versionNumber ?? 0) + 1;
  await prisma.$transaction(async (tx) => {
    const version = await tx.agentVersion.create({
      data: versionData(existing.id, nextNumber, snapshot),
    });
    await tx.agent.update({
      where: { id: existing.id },
      data: {
        name: snapshot.name,
        description: snapshot.description,
        currentVersionId: version.id,
      },
    });
  });
  return getAgent(userId, agentId);
}

export async function archiveAgent(userId: string, agentId: string) {
  const existing = await prisma.agent.findFirst({ where: { id: agentId, userId } });
  if (!existing) throw new NotFoundError();
  if (!existing.archivedAt) {
    await prisma.agent.update({
      where: { id: existing.id },
      data: { archivedAt: new Date() },
    });
  }
  return getAgent(userId, agentId);
}

export async function compareAgentVersions(
  userId: string,
  agentId: string,
  fromId: string,
  toId: string,
): Promise<{ instructions: InstructionChange[]; fields: FieldChange[] }> {
  const agent = await getAgent(userId, agentId);
  const from = agent.versions.find((version) => version.id === fromId);
  const to = agent.versions.find((version) => version.id === toId);
  if (!from || !to) throw new NotFoundError();
  return {
    instructions: diffInstructions(from.instructions, to.instructions),
    fields: diffSettings(from, to),
  };
}

function versionData(agentId: string, versionNumber: number, snapshot: AgentSnapshot) {
  return {
    agentId,
    versionNumber,
    name: snapshot.name,
    description: snapshot.description,
    instructions: snapshot.instructions,
    model: snapshot.model,
    temperature: snapshot.temperature,
    maxOutputTokens: snapshot.maxOutputTokens,
    toolConfig: { enabledTools: snapshot.enabledTools },
    memoryConfig: {
      enabled: snapshot.memoryEnabled,
      writeMode: snapshot.memoryWriteMode,
    },
    limits: {
      maxSteps: snapshot.maxSteps,
      maxTotalTokens: snapshot.maxTotalTokens,
      wallClockMs: snapshot.wallClockMs,
    },
    approvalPolicy: snapshot.approvalPolicy,
  };
}

function toVersion(version: VersionRecord) {
  const tools = readObject(version.toolConfig);
  const memory = readObject(version.memoryConfig);
  const limits = readObject(version.limits);
  const policy = normalizeApprovalPolicy(version.approvalPolicy);
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    createdAt: version.createdAt.toISOString(),
    name: version.name,
    description: version.description,
    instructions: version.instructions,
    model: version.model,
    temperature: version.temperature,
    maxOutputTokens: version.maxOutputTokens,
    enabledTools: Array.isArray(tools.enabledTools)
      ? (tools.enabledTools as AgentSnapshot["enabledTools"])
      : [],
    memoryEnabled: Boolean(memory.enabled),
    memoryWriteMode: (memory.writeMode ?? "propose") as AgentSnapshot["memoryWriteMode"],
    maxSteps: Number(limits.maxSteps),
    maxTotalTokens: Number(limits.maxTotalTokens),
    wallClockMs: Number(limits.wallClockMs),
    approvalPolicy: policy,
  };
}

export function readAgentSnapshot(version: VersionRecord) {
  return toVersion(version);
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
