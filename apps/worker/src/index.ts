import { config as loadEnv } from "dotenv";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { Worker } from "bullmq";

const envFile = resolve(import.meta.dirname, "../../../.env");
if (existsSync(envFile)) loadEnv({ path: envFile });

const { getWorkerEnv } = await import("@orvia/config");
const { checkHealth } = await import("@orvia/core");
const {
  LOCK_DURATION_MS,
  QUEUE_NAME,
  maintainExecutions,
  processExecutionJob,
  requestShutdown,
  workerConnection,
} = await import("@orvia/core/execution/runner");

const env = getWorkerEnv();
const report = await checkHealth(env.DATABASE_URL, env.REDIS_URL);
console.info(
  `postgres ${report.postgres}; redis ${report.redis}; vector ${report.vector}; queue prefix ${env.queuePrefix}`,
);
if (!report.ok) process.exit(1);

const workerId = `worker-${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
const connection = workerConnection(env.REDIS_URL);
const worker = new Worker(
  QUEUE_NAME,
  async (job, token) => {
    if (!token) throw new Error("missing lock token");
    await processExecutionJob({
      job,
      token,
      workerId,
      redisUrl: env.REDIS_URL,
      queuePrefix: env.queuePrefix,
      openAiApiKey: env.openAiApiKey,
      monthlyTokenCap: env.monthlyTokenBudget,
      concurrentRunCap: env.maxConcurrentExecutions,
      approvalTimeoutHours: env.approvalTimeoutHours,
      langfusePublicKey: env.langfusePublicKey,
      langfuseSecretKey: env.langfuseSecretKey,
      langfuseBaseUrl: env.langfuseBaseUrl,
      embeddingModel: env.openAiEmbeddingModel,
      credentialsKey: env.credentialsEncryptionKey,
      githubClientId: env.githubClientId,
      githubClientSecret: env.githubClientSecret,
      googleClientId: env.googleClientId,
      googleClientSecret: env.googleClientSecret,
      httpTimeoutMs: env.httpToolTimeoutMs,
      httpMaxResponseBytes: env.httpToolMaxResponseBytes,
      openAiModel: env.openAiModel,
    });
  },
  {
    connection,
    prefix: env.queuePrefix,
    concurrency: env.workerConcurrency,
    lockDuration: LOCK_DURATION_MS,
    stalledInterval: 30_000,
    maxStalledCount: 20,
  },
);

console.info(`worker ready with concurrency ${env.workerConcurrency}`);
void maintainExecutions(env.REDIS_URL, env.queuePrefix).catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : "maintenance");
});
const maintenance = setInterval(() => {
  void maintainExecutions(env.REDIS_URL, env.queuePrefix).catch((error: unknown) => {
    console.error(error instanceof Error ? error.name : "maintenance");
  });
}, 30_000);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  requestShutdown();
  clearInterval(maintenance);
  await worker.close();
  await connection.quit();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
