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

/** OpenAI web search tool fee on 11 Nov 2026: $10 per 1,000 calls. Search content tokens bill at model rates. */
export const WEB_SEARCH_USD_PER_CALL = 10 / 1_000;

const EMBEDDING_PRICES: Record<string, { inputPerMillion: number }> = {
  "text-embedding-3-small": { inputPerMillion: 0.02 },
};

export function hasEmbeddingPrice(model: string): boolean {
  return model in EMBEDDING_PRICES;
}

export function estimateEmbeddingCostUsd(model: string, tokens: number): number | null {
  if (tokens <= 0) return 0;
  const price = EMBEDDING_PRICES[model];
  if (!price) return null;
  return roundUsd((tokens * price.inputPerMillion) / 1_000_000);
}

export function estimateRunCostUsd(input: {
  model: string;
  usage: TokenUsage;
  embeddingModel: string;
  embeddingTokens: number;
  webSearchCalls: number;
}): number | null {
  const chat = estimateCostUsd(input.model, input.usage);
  const embedding = estimateEmbeddingCostUsd(input.embeddingModel, input.embeddingTokens);
  if (chat === null || embedding === null) return null;
  return roundUsd(chat + embedding + input.webSearchCalls * WEB_SEARCH_USD_PER_CALL);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function estimateCostUsd(model: string, usage: TokenUsage): number | null {
  const price = MODEL_PRICES[model];
  if (!price) return null;
  const cached = Math.min(Math.max(0, usage.cachedTokens), Math.max(0, usage.inputTokens));
  const uncached = Math.max(0, usage.inputTokens - cached);
  return roundUsd(
    (uncached * price.inputPerMillion +
      cached * price.cachedInputPerMillion +
      usage.outputTokens * price.outputPerMillion) /
      1_000_000,
  );
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
