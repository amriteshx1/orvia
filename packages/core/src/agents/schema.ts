import { z } from "zod";
import {
  APPROVAL_MODES,
  MEMORY_WRITE_MODES,
  TOOL_IDS,
  type AgentSnapshot,
  type ApprovalPolicy,
} from "./defaults";

const mode = z.enum(APPROVAL_MODES);
const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.-]+$/, "Enter a domain without a scheme")
  .max(253);
const optionalId = z
  .union([z.string().uuid(), z.literal(""), z.null()])
  .optional()
  .transform((value) => (value ? value : null));

export const agentInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(2_000),
  instructions: z.string().trim().min(1, "Instructions are required").max(100_000),
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().min(1).max(128_000),
  enabledTools: z.array(z.enum(TOOL_IDS)),
  memoryEnabled: z.boolean(),
  memoryWriteMode: z.enum(MEMORY_WRITE_MODES),
  maxSteps: z.number().int().min(1).max(100),
  maxTotalTokens: z.number().int().min(1).max(2_000_000),
  wallClockMs: z.number().int().min(1_000).max(86_400_000),
  maxWebSearchCalls: z.number().int().min(0).max(50).default(3),
  webSearchAllowedDomains: z.array(domain).max(100).default([]),
  webSearchBlockedDomains: z.array(domain).max(100).default([]),
  httpAllowedDomains: z.array(domain).max(100).default([]),
  githubConnectionId: optionalId.default(null),
  gmailConnectionId: optionalId.default(null),
  httpConnectionIds: z.array(z.string().uuid()).max(20).default([]),
  approvalPolicy: z.object({
    unknown: mode,
    tools: z.object({
      fixture_action: mode,
      web_search: mode,
      http_public_get: mode,
      http_credentialed: mode,
      http_mutation: mode,
      github_read: mode,
      github_write: mode,
      gmail_read: mode,
      gmail_send: mode,
      slack_read: mode,
      slack_post: mode,
      memory_search: mode,
      memory_update: mode,
      memory_delete: mode,
      gmail_draft: mode,
    }),
  }),
});

export type AgentInput = z.infer<typeof agentInputSchema>;

export class ValidationError extends Error {
  readonly code = "validation";

  constructor(readonly issues: { path: string; message: string }[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  readonly code = "not_found";

  constructor() {
    super("Not found");
    this.name = "NotFoundError";
  }
}

export function parseAgentInput(value: unknown): AgentInput {
  const parsed = agentInputSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return {
    ...parsed.data,
    enabledTools: [...new Set(parsed.data.enabledTools)],
  };
}

export function snapshotFromInput(input: AgentInput, model: string): AgentSnapshot {
  return {
    ...input,
    model,
    approvalPolicy: input.approvalPolicy as ApprovalPolicy,
  };
}
