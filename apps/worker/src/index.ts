import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { getWorkerEnv } from "@orvia/config";
import { checkHealth } from "@orvia/core";

const envFile = resolve(import.meta.dirname, "../../../.env");
if (existsSync(envFile)) loadEnv({ path: envFile });

const env = getWorkerEnv();
const report = await checkHealth(env.DATABASE_URL, env.REDIS_URL);

console.info(
  `postgres ${report.postgres}; redis ${report.redis}; vector ${report.vector}; queue prefix ${env.queuePrefix}`,
);

if (!report.ok) {
  process.exit(1);
}

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue("orvia", { connection, prefix: env.queuePrefix });
await queue.waitUntilReady();
console.info(`worker ready with concurrency ${env.workerConcurrency}`);

async function shutdown() {
  await queue.close();
  await connection.quit();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
