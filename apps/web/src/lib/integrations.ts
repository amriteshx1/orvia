import { getWebEnv } from "@orvia/config";
import type { EvalRuntime } from "@orvia/core/evals";

export function integrationApp() {
  const env = getWebEnv();
  return {
    env,
    app: {
      clientId: undefined as string | undefined,
      clientSecret: undefined as string | undefined,
      appUrl: env.appUrl,
    },
    github: { clientId: env.githubClientId, clientSecret: env.githubClientSecret, appUrl: env.appUrl },
    google: { clientId: env.googleClientId, clientSecret: env.googleClientSecret, appUrl: env.appUrl },
    caps: { monthlyTokenCap: env.monthlyTokenBudget, concurrentRunCap: env.maxConcurrentExecutions },
  };
}

export function evaluationRuntime(): EvalRuntime {
  const env = getWebEnv();
  return {
    redisUrl: env.REDIS_URL,
    queuePrefix: env.queuePrefix,
    monthlyTokenCap: env.monthlyTokenBudget,
    concurrentRunCap: env.maxConcurrentExecutions,
    openAiApiKey: env.openAiApiKey,
    openAiModel: env.openAiModel,
  };
}
