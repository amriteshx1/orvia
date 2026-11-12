import { truncateToolResult } from "../truncate";
import { dispatchEffect } from "../execution/effects";
import { EffectFailed } from "../execution/errors";
import { safeErrorMessage } from "../execution/constants";
import { runGithub } from "./github";
import { runGmail } from "./gmail";
import { runHttpRequest } from "./http-tool";
import { runMemoryDelete, runMemorySave, runMemorySearch, runMemoryUpdate } from "./memory-tool";
import type { ToolCall, ToolRuntime } from "./runtime";
import { readRecord, text } from "./runtime";
import { runWebSearch } from "./web-search";

export async function executeRecordedTool(runtime: ToolRuntime, call: ToolCall): Promise<string> {
  const result = await executeRaw(runtime, call);
  runtime.onToolSpan?.(call.toolName, call.input, result);
  return truncateToolResult(result);
}

async function executeRaw(runtime: ToolRuntime, call: ToolCall): Promise<unknown> {
  switch (call.toolName) {
    case "fixture_action":
      return runFixture(runtime, call);
    case "web_search":
      return runWebSearch(runtime, call);
    case "http_request":
      return runHttpRequest(runtime, call);
    case "memory_search":
      return runMemorySearch(runtime, call);
    case "memory_save":
      return runMemorySave(runtime, call);
    case "memory_update":
      return runMemoryUpdate(runtime, call);
    case "memory_delete":
      return runMemoryDelete(runtime, call);
    case "github_user":
    case "github_repos":
    case "github_read_file":
    case "github_create_issue":
    case "github_comment":
      return runGithub(runtime, call);
    case "gmail_search":
    case "gmail_read":
    case "gmail_create_draft":
    case "gmail_send":
      return runGmail(runtime, call);
    default:
      return { ok: false, error: "unknown_tool", message: "That tool is not available." };
  }
}

async function runFixture(runtime: ToolRuntime, call: ToolCall) {
  const input = readRecord(call.input);
  const action = text(input.action, 200);
  const payload = typeof input.payload === "string" ? input.payload.slice(0, 4_000) : "";
  if (!action) return { ok: false, error: "invalid_input", message: "An action is required." };
  try {
    return await dispatchEffect({
      fence: runtime.fence,
      toolCallId: call.toolCallId,
      toolName: "fixture_action",
      input: { action, payload },
      idempotencyKey: null,
      signal: call.signal,
      perform: async () => ({ ok: true, action, payload }),
    });
  } catch (error) {
    if (error instanceof EffectFailed) return { ok: false, error: "effect_failed", message: safeErrorMessage("effect_failed") };
    throw error;
  }
}
