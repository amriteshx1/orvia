import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { BudgetStopped, EffectRetry, EffectUncertain, LeaseLost } from "../execution/errors";
import { executeRecordedTool } from "./execute";
import type { ToolRuntime } from "./runtime";

export function createAgentTools(
  runtime: ToolRuntime,
  handlers: {
    onFatal: (code: "effect_uncertain" | "effect_failed") => void;
    onLostLease: () => void;
    onRetry: () => void;
    onBudget: () => void;
  },
): ToolSet {
  const tools: ToolSet = {};
  const enabled = new Set(runtime.snapshot.enabledTools);
  const bind = (name: string, description: string, schema: z.ZodType) =>
    tool({
      description,
      inputSchema: schema,
      execute: (input, options) =>
        guarded(runtime, handlers, name, options.toolCallId, input, options.abortSignal),
    });

  if (enabled.has("fixture")) {
    tools.fixture_action = bind(
      "fixture_action",
      "Record a local fixture action. Use this only when the user asks for the fixture action. It does not contact an external service.",
      z.object({ action: z.string().min(1).max(200), payload: z.string().max(4_000) }),
    );
  }
  if (enabled.has("web_search")) {
    tools.web_search = bind(
      "web_search",
      "Search the public web with OpenAI web search. Pass one focused query. The result includes source URLs.",
      z.object({ query: z.string().min(1).max(500) }),
    );
  }
  if (enabled.has("http_request")) {
    const connections = runtime.snapshot.httpConnectionIds.join(", ") || "none";
    tools.http_request = bind(
      "http_request",
      `Call an external HTTP API. Public GET needs no connection. Credentialed calls and every non-GET method need a granted connection id. Granted HTTP connection ids: ${connections}. Do not invent credentials or authorization headers.`,
      z.object({
        connectionId: z.string().uuid().optional(),
        url: z.string().min(1).max(2_000),
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).optional(),
        query: z.record(z.string(), z.string()).optional(),
        headers: z.record(z.string(), z.string()).optional(),
        body: z.string().max(100_000).optional(),
      }),
    );
  }
  if (enabled.has("memory") && runtime.snapshot.memoryEnabled) {
    tools.memory_search = bind(
      "memory_search",
      "Search this agent's accepted memories. Proposed and deleted memories are not returned.",
      z.object({ query: z.string().min(1).max(2_000) }),
    );
    tools.memory_save = bind(
      "memory_save",
      "Save one durable fact for this agent. Do not save the whole transcript. In propose mode the fact is not retrievable until the user accepts it.",
      z.object({ content: z.string().min(1).max(4_000) }),
    );
    tools.memory_update = bind(
      "memory_update",
      "Replace the content of one of this agent's memories.",
      z.object({ id: z.string().uuid(), content: z.string().min(1).max(4_000) }),
    );
    tools.memory_delete = bind(
      "memory_delete",
      "Delete one of this agent's memories.",
      z.object({ id: z.string().uuid() }),
    );
  }
  if (enabled.has("github") && runtime.snapshot.githubConnectionId) {
    tools.github_user = bind("github_user", "Read the authenticated GitHub user.", z.object({}));
    tools.github_repos = bind("github_repos", "List repositories the authenticated GitHub user can access.", z.object({}));
    tools.github_read_file = bind(
      "github_read_file",
      "Read a file from a GitHub repository.",
      z.object({ owner: z.string().min(1).max(100), repo: z.string().min(1).max(100), path: z.string().min(1).max(500) }),
    );
    tools.github_create_issue = bind(
      "github_create_issue",
      "Create a GitHub issue. This waits for approval and is sent at most once.",
      z.object({
        owner: z.string().min(1).max(100),
        repo: z.string().min(1).max(100),
        title: z.string().min(1).max(200),
        body: z.string().max(20_000).optional(),
      }),
    );
    tools.github_comment = bind(
      "github_comment",
      "Comment on a GitHub issue. This waits for approval and is sent at most once.",
      z.object({
        owner: z.string().min(1).max(100),
        repo: z.string().min(1).max(100),
        issueNumber: z.number().int().positive(),
        body: z.string().min(1).max(20_000),
      }),
    );
  }
  if (enabled.has("gmail") && runtime.snapshot.gmailConnectionId) {
    tools.gmail_search = bind(
      "gmail_search",
      "Search the connected mailbox. Returns ids, senders, and subjects.",
      z.object({ query: z.string().min(1).max(500) }),
    );
    tools.gmail_read = bind(
      "gmail_read",
      "Read one Gmail message by id.",
      z.object({ id: z.string().min(1).max(200) }),
    );
    tools.gmail_create_draft = bind(
      "gmail_create_draft",
      "Create a Gmail draft. This does not send the message.",
      z.object({ to: z.string().min(3).max(500), subject: z.string().min(1).max(500), body: z.string().min(1).max(20_000) }),
    );
    tools.gmail_send = bind(
      "gmail_send",
      "Send an email from the connected mailbox. Sending always waits for approval and is attempted at most once.",
      z.object({ to: z.string().min(3).max(500), subject: z.string().min(1).max(500), body: z.string().min(1).max(20_000) }),
    );
  }
  return tools;
}

async function guarded(
  runtime: ToolRuntime,
  handlers: {
    onFatal: (code: "effect_uncertain" | "effect_failed") => void;
    onLostLease: () => void;
    onRetry: () => void;
    onBudget: () => void;
  },
  toolName: string,
  toolCallId: string,
  input: unknown,
  signal: AbortSignal | undefined,
) {
  try {
    return await executeRecordedTool(runtime, { toolName, toolCallId, input, signal });
  } catch (error) {
    if (error instanceof LeaseLost) {
      handlers.onLostLease();
      throw error;
    }
    if (error instanceof EffectUncertain) {
      handlers.onFatal("effect_uncertain");
      throw error;
    }
    if (error instanceof EffectRetry) {
      handlers.onRetry();
      throw error;
    }
    if (error instanceof BudgetStopped) {
      handlers.onBudget();
      throw error;
    }
    throw error;
  }
}
