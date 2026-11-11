export const TOOL_IDS = [
  "web_search",
  "http_request",
  "memory",
  "github",
  "gmail",
  "slack",
] as const;

export const APPROVAL_ACTIONS = [
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
  approvalPolicy: ApprovalPolicy;
};

export type AgentDefaults = {
  maxSteps: number;
  wallClockMs: number;
  tokenBudget: number;
};

export function defaultApprovalPolicy(): ApprovalPolicy {
  return {
    unknown: "require_approval",
    tools: {
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
    },
  };
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
    approvalPolicy: defaultApprovalPolicy(),
  };
}
