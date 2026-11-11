import { Queue } from "bullmq";
import Redis from "ioredis";
import { QUEUE_NAME } from "./constants";

export type ExecutionJobData = {
  executionId: string;
  kind: "run" | "resume";
};

const queues = new Map<string, Queue<ExecutionJobData>>();

const jobOptions = {
  attempts: 50,
  backoff: { type: "exponential" as const, delay: 2_000 },
  removeOnComplete: false as const,
  removeOnFail: false as const,
};

export function getQueue(redisUrl: string, prefix: string): Queue<ExecutionJobData> {
  const key = `${prefix}\n${redisUrl}`;
  let queue = queues.get(key);
  if (!queue) {
    queue = new Queue<ExecutionJobData>(QUEUE_NAME, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
      prefix,
      defaultJobOptions: jobOptions,
    });
    queues.set(key, queue);
  }
  return queue;
}

export async function ensureJob(
  redisUrl: string,
  prefix: string,
  jobId: string,
  name: string,
  data: ExecutionJobData,
) {
  const queue = getQueue(redisUrl, prefix);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state !== "completed" && state !== "failed" && state !== "unknown") return;
    await existing.remove();
  }
  await queue.add(name, data, { ...jobOptions, jobId });
}

export async function enqueueRun(redisUrl: string, prefix: string, executionId: string) {
  await getQueue(redisUrl, prefix).add(
    "run",
    { executionId, kind: "run" },
    { ...jobOptions, jobId: `run-${executionId}` },
  );
}

export async function enqueueResume(
  redisUrl: string,
  prefix: string,
  executionId: string,
  stepIndex: number,
) {
  await getQueue(redisUrl, prefix).add(
    "resume",
    { executionId, kind: "resume" },
    { ...jobOptions, jobId: `resume-${executionId}-${stepIndex}` },
  );
}

export async function enqueueRecover(
  redisUrl: string,
  prefix: string,
  executionId: string,
  fencingToken: number,
) {
  await getQueue(redisUrl, prefix).add(
    "recover",
    { executionId, kind: "run" },
    { ...jobOptions, jobId: `recover-${executionId}-${fencingToken}` },
  );
}

export function workerConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}
