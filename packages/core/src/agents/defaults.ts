export const TOOL_IDS = [
  "fixture",
  "web_search",
  "http_request",
  "memory",
  "github",
  "gmail",
  "slack",
] as const;

export const APPROVAL_ACTIONS = [
  "fixture_action",
  "web_search",
  "http_public_get",
  "http_credentialed",
  "http_mutation",
  "github_read",
  "github_write",
  "gmail_read",
  "gmail_send",
  "slack_read",
  "slack_post",
  "memory_search",
  "memory_update",
  "memory_delete",
  "gmail_draft",
] as const;

export const APPROVAL_MODES = ["auto", "require_approval", "deny"] as const;
export const MEMORY_WRITE_MODES = ["propose", "auto", "approval_pause"] as const;

export type ToolId = (typeof TOOL_IDS)[number];
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];
export type ApprovalMode = (typeof APPROVAL_MODES)[number];
export type MemoryWriteMode = (typeof MEMORY_WRITE_MODES)[number];

export type ApprovalPolicy = {
  unknown: ApprovalMode;
  tools: Record<ApprovalAction, ApprovalMode>;
};

export type AgentSnapshot = {
  name: string;
  description: string;
  instructions: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  enabledTools: ToolId[];
  memoryEnabled: boolean;
  memoryWriteMode: MemoryWriteMode;
  maxSteps: number;
  maxTotalTokens: number;
  wallClockMs: number;
  maxWebSearchCalls: number;
  webSearchAllowedDomains: string[];
  webSearchBlockedDomains: string[];
  httpAllowedDomains: string[];
  githubConnectionId: string | null;
  gmailConnectionId: string | null;
  httpConnectionIds: string[];
  approvalPolicy: ApprovalPolicy;
};

export type AgentDefaults = {
  maxSteps: number;
  wallClockMs: number;
  tokenBudget: number;
  maxWebSearchCalls: number;
};

export function defaultApprovalPolicy(): ApprovalPolicy {
  return {
    unknown: "require_approval",
    tools: {
      fixture_action: "require_approval",
      web_search: "auto",
      http_public_get: "auto",
      http_credentialed: "require_approval",
      http_mutation: "require_approval",
      github_read: "auto",
      github_write: "require_approval",
      gmail_read: "auto",
      gmail_send: "require_approval",
      slack_read: "auto",
      slack_post: "require_approval",
      memory_search: "auto",
      memory_update: "require_approval",
      memory_delete: "require_approval",
      gmail_draft: "auto",
    },
  };
}

export function normalizeApprovalPolicy(value: unknown): ApprovalPolicy {
  const defaults = defaultApprovalPolicy();
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as { unknown?: unknown; tools?: unknown })
      : {};
  const tools =
    record.tools && typeof record.tools === "object" && !Array.isArray(record.tools)
      ? (record.tools as Record<string, unknown>)
      : {};
  return {
    unknown: asMode(record.unknown, defaults.unknown),
    tools: Object.fromEntries(
      APPROVAL_ACTIONS.map((action) => [action, asMode(tools[action], defaults.tools[action])]),
    ) as ApprovalPolicy["tools"],
  };
}

export function approvalModeFor(policy: ApprovalPolicy, toolName: string): ApprovalMode {
  if ((APPROVAL_ACTIONS as readonly string[]).includes(toolName)) {
    return policy.tools[toolName as ApprovalAction];
  }
  return policy.unknown;
}

function asMode(value: unknown, fallback: ApprovalMode): ApprovalMode {
  return (APPROVAL_MODES as readonly string[]).includes(String(value))
    ? (value as ApprovalMode)
    : fallback;
}

export function defaultSnapshot(model: string, defaults: AgentDefaults): AgentSnapshot {
  return {
    name: "",
    description: "",
    instructions: "",
    model,
    temperature: 0.2,
    maxOutputTokens: 2048,
    enabledTools: [],
    memoryEnabled: false,
    memoryWriteMode: "propose",
    maxSteps: defaults.maxSteps,
    maxTotalTokens: defaults.tokenBudget,
    wallClockMs: defaults.wallClockMs,
    maxWebSearchCalls: defaults.maxWebSearchCalls,
    webSearchAllowedDomains: [],
    webSearchBlockedDomains: [],
    httpAllowedDomains: [],
    githubConnectionId: null,
    gmailConnectionId: null,
    httpConnectionIds: [],
    approvalPolicy: defaultApprovalPolicy(),
  };
}
