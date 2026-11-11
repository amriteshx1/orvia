import { getWebEnv } from "@orvia/config";
import type { ExecutionRuntime } from "@orvia/core/execution";

export function executionRuntime(): ExecutionRuntime {
  const env = getWebEnv();
  return {
    redisUrl: env.REDIS_URL,
    queuePrefix: env.queuePrefix,
    monthlyTokenCap: env.monthlyTokenBudget,
    concurrentRunCap: env.maxConcurrentExecutions,
    approvalTimeoutHours: env.approvalTimeoutHours,
  };
}
