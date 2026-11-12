export const QUEUE_NAME = "orvia";
export const HEARTBEAT_MS = 10_000;
export const LEASE_TTL_MS = 30_000;
export const LOCK_DURATION_MS = 60_000;
export const CHECKPOINT_SCHEMA_VERSION = 1;
export const MODEL_TOOL_OUTPUT_CHARS = 8_000;
export const STORED_OUTPUT_CHARS = 100_000;
export const ACTIVE_STATUSES = ["queued", "running", "waitingApproval"] as const;

export const SAFE_ERROR_MESSAGES: Record<string, string> = {
  budget_exceeded: "This run stopped because it would exceed a token budget.",
  wall_clock_exceeded: "This run stopped because it reached its time limit.",
  approval_expired: "The approval expired before a decision, so the action was not performed.",
  cancelled: "This run was cancelled.",
  provider_error: "The model provider returned an error.",
  openai_not_configured: "The worker is missing an OpenAI API key.",
  unpriced_model: "This model has no price entry, so the run was not started.",
  effect_uncertain:
    "A tool call may have been sent and will not be retried until its outcome is reconciled.",
  effect_failed: "A tool call failed and was not sent again.",
  checkpoint_unsupported: "This run cannot resume because its checkpoint format is unsupported.",
  ssrf_blocked: "The HTTP request was blocked because its address is not public.",
  connection_unavailable: "The connection is missing, revoked, or not granted to this agent.",
  encryption_unconfigured: "Connection secrets are unavailable until an encryption key is configured.",
  oauth_unconfigured: "This provider's OAuth credentials are not configured.",
  internal_error: "The run failed.",
};

export function safeErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return SAFE_ERROR_MESSAGES[code] ?? SAFE_ERROR_MESSAGES.internal_error;
}
