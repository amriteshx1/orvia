import { estimateReservation, type TokenUsage } from "../pricing";

export function readResponseUsage(body: {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
}): TokenUsage | null {
  const usage = body.usage;
  if (!usage) return null;
  const inputTokens = usage.input_tokens ?? usage.prompt_tokens;
  const outputTokens = usage.output_tokens ?? Math.max(0, (usage.total_tokens ?? 0) - (inputTokens ?? 0));
  if (inputTokens === undefined && usage.total_tokens === undefined) return null;
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
  };
}

export function reservationFor(payload: unknown, maxOutputTokens: number): number {
  return estimateReservation(JSON.stringify(payload).length, maxOutputTokens);
}
