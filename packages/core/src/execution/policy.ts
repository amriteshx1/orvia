import { approvalModeFor, type AgentSnapshot, type ApprovalMode } from "../agents/defaults";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function approvalActionFor(toolName: string, input: unknown): string {
  const body = record(input);
  if (toolName === "http_request") {
    const method = typeof body.method === "string" ? body.method.toUpperCase() : "GET";
    if (method !== "GET") return "http_mutation";
    if (typeof body.connectionId === "string" && body.connectionId.length > 0) return "http_credentialed";
    return "http_public_get";
  }
  if (toolName === "github_user" || toolName === "github_repos" || toolName === "github_read_file") return "github_read";
  if (toolName === "github_create_issue" || toolName === "github_comment") return "github_write";
  if (toolName === "gmail_search" || toolName === "gmail_read") return "gmail_read";
  if (toolName === "gmail_create_draft") return "gmail_draft";
  if (toolName === "gmail_send") return "gmail_send";
  return toolName;
}

export function resolveApproval(snapshot: AgentSnapshot, toolName: string, input: unknown): ApprovalMode {
  if (toolName === "gmail_send") {
    return approvalModeFor(snapshot.approvalPolicy, "gmail_send") === "deny" ? "deny" : "require_approval";
  }
  if (toolName === "memory_save") {
    return snapshot.memoryWriteMode === "approval_pause" ? "require_approval" : "auto";
  }
  return approvalModeFor(snapshot.approvalPolicy, approvalActionFor(toolName, input));
}
