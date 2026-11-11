import { z } from "zod";

const nodeEnv = z.enum(["development", "test", "production"]).default("development");

const sharedSchema = z.object({
  NODE_ENV: nodeEnv,
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  QUEUE_PREFIX: z.string().min(1).optional(),
});

export type SharedEnv = z.infer<typeof sharedSchema> & {
  queuePrefix: string;
};

export type WebEnv = SharedEnv & {
  appUrl: string;
  betterAuthUrl: string;
  betterAuthSecret: string;
  openAiModel: string;
  emailVerificationRequired: boolean;
  emailFrom: string;
  smtpHost?: string;
  smtpPort: number;
  smtpUser?: string;
  smtpPassword?: string;
  defaultMaxSteps: number;
  defaultMaxWallClockMs: number;
  defaultAgentTokenBudget: number;
};

export type WorkerEnv = SharedEnv & {
  workerConcurrency: number;
};

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

function read(source: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = source[key];
  if (value === undefined || value.trim() === "") return undefined;
  return value.trim();
}

function flag(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new EnvError(`${name} must be true or false`);
}

export function resolveQueuePrefix(env: {
  NODE_ENV: "development" | "test" | "production";
  QUEUE_PREFIX?: string;
}): string {
  if (env.QUEUE_PREFIX) return env.QUEUE_PREFIX;
  return env.NODE_ENV === "test" ? "orvia-test" : "orvia-dev";
}

function parseShared(source: NodeJS.ProcessEnv): SharedEnv {
  const parsed = sharedSchema.safeParse({
    NODE_ENV: read(source, "NODE_ENV"),
    DATABASE_URL: read(source, "DATABASE_URL"),
    REDIS_URL: read(source, "REDIS_URL"),
    LOG_LEVEL: read(source, "LOG_LEVEL"),
    QUEUE_PREFIX: read(source, "QUEUE_PREFIX"),
  });
  if (!parsed.success) {
    throw new EnvError(
      parsed.error.issues
        .map((issue) => {
          const path = issue.path.join(".");
          return path ? `${path}: ${issue.message}` : issue.message;
        })
        .join("\n"),
    );
  }
  return {
    ...parsed.data,
    queuePrefix: resolveQueuePrefix(parsed.data),
  };
}

export function parseWebEnv(source: NodeJS.ProcessEnv = process.env): WebEnv {
  const shared = parseShared(source);
  const appUrl = read(source, "APP_URL");
  const secret = read(source, "BETTER_AUTH_SECRET");
  if (!appUrl) throw new EnvError("APP_URL is required");
  if (!secret || secret.length < 32) {
    throw new EnvError("BETTER_AUTH_SECRET is required and must be at least 32 characters");
  }
  const emailVerificationRequired = flag(
    read(source, "EMAIL_VERIFICATION_REQUIRED"),
    shared.NODE_ENV === "production",
    "EMAIL_VERIFICATION_REQUIRED",
  );
  const smtpHost = read(source, "SMTP_HOST");
  if (shared.NODE_ENV === "production" && emailVerificationRequired && !smtpHost) {
    throw new EnvError(
      "SMTP_HOST is required when email verification is enabled in production",
    );
  }
  const smtpPort = Number(read(source, "SMTP_PORT") ?? "587");
  if (!Number.isInteger(smtpPort) || smtpPort <= 0) {
    throw new EnvError("SMTP_PORT must be a positive integer");
  }
  return {
    ...shared,
    appUrl,
    betterAuthUrl: read(source, "BETTER_AUTH_URL") ?? appUrl,
    betterAuthSecret: secret,
    openAiModel: read(source, "OPENAI_MODEL") ?? "gpt-6-luna",
    emailVerificationRequired,
    emailFrom: read(source, "EMAIL_FROM") ?? "Orvia <noreply@localhost>",
    smtpHost,
    smtpPort,
    smtpUser: read(source, "SMTP_USER"),
    smtpPassword: read(source, "SMTP_PASSWORD"),
    defaultMaxSteps: positiveInt(read(source, "DEFAULT_MAX_STEPS"), 8, "DEFAULT_MAX_STEPS"),
    defaultMaxWallClockMs: positiveInt(
      read(source, "DEFAULT_MAX_WALL_CLOCK_MS"),
      600_000,
      "DEFAULT_MAX_WALL_CLOCK_MS",
    ),
    defaultAgentTokenBudget: positiveInt(
      read(source, "DEFAULT_AGENT_TOKEN_BUDGET"),
      100_000,
      "DEFAULT_AGENT_TOKEN_BUDGET",
    ),
  };
}

export function parseWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const shared = parseShared(source);
  return {
    ...shared,
    workerConcurrency: positiveInt(
      read(source, "WORKER_CONCURRENCY"),
      2,
      "WORKER_CONCURRENCY",
    ),
  };
}

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new EnvError(`${name} must be a positive integer`);
  }
  return parsed;
}

let webEnv: WebEnv | undefined;
let workerEnv: WorkerEnv | undefined;

export function getWebEnv(): WebEnv {
  webEnv ??= parseWebEnv();
  return webEnv;
}

export function getWorkerEnv(): WorkerEnv {
  workerEnv ??= parseWorkerEnv();
  return workerEnv;
}
