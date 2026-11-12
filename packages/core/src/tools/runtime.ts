import type { AgentSnapshot } from "../agents/defaults";
import type { Fence } from "../execution/lease";

export type ToolRuntime = {
  fence: Fence;
  userId: string;
  agentId: string;
  snapshot: AgentSnapshot;
  openAiApiKey?: string;
  embeddingModel: string;
  credentialsKey?: string;
  githubClientId?: string;
  githubClientSecret?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  httpTimeoutMs: number;
  httpMaxResponseBytes: number;
  monthlyTokenCap: number;
  concurrentRunCap: number;
  onToolSpan?: (toolName: string, input: unknown, output: unknown) => void;
};

export type ToolCall = {
  toolCallId: string;
  toolName: string;
  input: unknown;
  signal?: AbortSignal;
};

export function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function text(value: unknown, max = 8_000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
