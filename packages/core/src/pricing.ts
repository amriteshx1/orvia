export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
};

type ModelPrice = {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
};

/** Standard rates from the 11 Nov 2026 OpenAI pricing page. Inputs above 272K tokens may bill at a higher long-context rate. */
const MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-6-luna": {
    inputPerMillion: 0.1,
    cachedInputPerMillion: 0.01,
    outputPerMillion: 0.5,
  },
};

export const LONG_CONTEXT_INPUT_TOKENS = 272_000;

export function hasModelPrice(model: string): boolean {
  return model in MODEL_PRICES;
}

export function budgetTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cachedTokens + usage.reasoningTokens;
}

export function estimateReservation(messageChars: number, maxOutputTokens: number): number {
  const inputTokens = Math.max(1, Math.ceil(messageChars / 4));
  const outputTokens = Math.max(1, maxOutputTokens);
  const cachedTokens = inputTokens;
  return inputTokens + outputTokens + cachedTokens;
}

export function estimateCostUsd(model: string, usage: TokenUsage): number | null {
  const price = MODEL_PRICES[model];
  if (!price) return null;
  const cached = Math.min(Math.max(0, usage.cachedTokens), Math.max(0, usage.inputTokens));
  const uncached = Math.max(0, usage.inputTokens - cached);
  const usd =
    (uncached * price.inputPerMillion +
      cached * price.cachedInputPerMillion +
      usage.outputTokens * price.outputPerMillion) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 };
}

export function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cachedTokens: left.cachedTokens + right.cachedTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
  };
}
