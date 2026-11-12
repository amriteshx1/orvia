import { prisma } from "@orvia/db";
import { withPaidCall } from "../execution/budget";
import { recordToolStep } from "../execution/effects";
import type { ToolCall, ToolRuntime } from "./runtime";
import { readResponseUsage, reservationFor } from "./openai";
import { text } from "./runtime";

type Source = { url: string; title?: string };

export async function runWebSearch(runtime: ToolRuntime, call: ToolCall) {
  const query = text(readQuery(call.input), 500);
  if (!query) return { ok: false, error: "invalid_input", message: "A search query is required." };
  const cap = runtime.snapshot.maxWebSearchCalls;
  const used = await prisma.executionStep.count({
    where: {
      executionId: runtime.fence.executionId,
      kind: "tool",
      toolName: "web_search",
      NOT: { output: { path: ["stopped"], equals: true } },
    },
  });
  if (used >= cap) {
    const output = { ok: false, stopped: true, error: "web_search_call_cap", query, message: "The web search call cap for this run has been reached." };
    await recordToolStep(runtime.fence, "web_search", { query }, output);
    return output;
  }
  if (!runtime.openAiApiKey) {
    return { ok: false, error: "openai_not_configured", message: "Web search needs an OpenAI API key." };
  }
  const filters: { allowed_domains?: string[]; blocked_domains?: string[] } = {};
  if (runtime.snapshot.webSearchAllowedDomains.length > 0) filters.allowed_domains = runtime.snapshot.webSearchAllowedDomains;
  if (runtime.snapshot.webSearchBlockedDomains.length > 0) filters.blocked_domains = runtime.snapshot.webSearchBlockedDomains;
  const requestBody = {
    model: runtime.snapshot.model,
    input: query,
    tools: [{ type: "web_search", search_context_size: "low", ...(Object.keys(filters).length ? { filters } : {}) }],
    tool_choice: { type: "web_search" },
    reasoning: { effort: "none" },
    store: false,
    include: ["web_search_call.results"],
  };
  const result = await withPaidCall<
    | { ok: false; error: string; query: string; message: string }
    | { ok: true; query: string; queries: string[]; answer: string; sources: Source[] }
  >({
    fence: runtime.fence,
    userId: runtime.userId,
    estimate: reservationFor(requestBody, 2_000),
    executionCap: runtime.snapshot.maxTotalTokens,
    caps: { monthlyTokenCap: runtime.monthlyTokenCap, concurrentRunCap: runtime.concurrentRunCap },
    model: runtime.snapshot.model,
    embeddingModel: runtime.embeddingModel,
    run: async (markSent) => {
      markSent();
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${runtime.openAiApiKey}`, "content-type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: call.signal,
      });
      const body = (await response.json().catch(() => ({}))) as {
        output?: unknown[];
        output_text?: string;
        error?: { message?: string };
        usage?: Parameters<typeof readResponseUsage>[0]["usage"];
      };
      const usage = readResponseUsage(body);
      if (!response.ok) {
        return {
          value: { ok: false, error: "provider_error", query, message: "OpenAI web search failed." },
          usage,
          usageKnown: true,
        };
      }
      const parsed = parseSearch(body, query);
      return { value: parsed, usage, usageKnown: usage !== null, webSearchDelta: 1 };
    },
  });
  await recordToolStep(runtime.fence, "web_search", { query }, result);
  return result;
}

function readQuery(input: unknown): unknown {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  return record.query ?? record.q ?? "";
}

function parseSearch(body: { output?: unknown[]; output_text?: string }, query: string) {
  const sources: Source[] = [];
  const queries = new Set<string>([query]);
  const texts: string[] = [];
  if (body.output_text) texts.push(body.output_text);
  for (const item of body.output ?? []) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const action = record.action && typeof record.action === "object" ? (record.action as Record<string, unknown>) : null;
    if (typeof action?.query === "string") queries.add(action.query);
    if (Array.isArray(action?.queries)) {
      for (const value of action.queries) if (typeof value === "string") queries.add(value);
    }
    collectSources(record.sources, sources);
    collectSources(record.results, sources);
    if (Array.isArray(record.content)) {
      for (const part of record.content) {
        if (!part || typeof part !== "object") continue;
        const content = part as Record<string, unknown>;
        if (typeof content.text === "string") texts.push(content.text);
        collectSources(content.annotations, sources);
      }
    }
  }
  const unique = dedupeSources(sources);
  return {
    ok: true as const,
    query: [...queries][0] ?? query,
    queries: [...queries],
    answer: texts.join("\n").slice(0, 8_000),
    sources: unique,
  };
}

function collectSources(value: unknown, sources: Source[]) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url : typeof record.link === "string" ? record.link : "";
    if (!url.startsWith("http://") && !url.startsWith("https://")) continue;
    sources.push({ url, title: typeof record.title === "string" ? record.title : undefined });
  }
}

function dedupeSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  const output: Source[] = [];
  for (const source of sources) {
    if (seen.has(source.url)) continue;
    seen.add(source.url);
    output.push(source);
    if (output.length >= 8) break;
  }
  return output;
}
