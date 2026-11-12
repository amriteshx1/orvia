import { Langfuse } from "langfuse";
import type { TokenUsage } from "./pricing";
import { redact } from "./redact";

export type RunTelemetry = {
  enabled: boolean;
  generation(model: string, usage: TokenUsage, input?: unknown, output?: unknown, latencyMs?: number): void;
  toolSpan(name: string, input: unknown, output: unknown, latencyMs?: number): void;
  flush(): Promise<void>;
};

const noop: RunTelemetry = {
  enabled: false,
  generation() {},
  toolSpan() {},
  async flush() {},
};

const SENSITIVE = /^(body|raw|snippet|html|payload|authorization|accessToken|refreshToken|cookie|set-cookie)$/i;

export function createRunTelemetry(options: {
  publicKey?: string;
  secretKey?: string;
  baseUrl?: string;
  executionId: string;
  userId: string;
}): RunTelemetry {
  if (!options.publicKey || !options.secretKey) return noop;
  try {
    const client = new Langfuse({
      publicKey: options.publicKey,
      secretKey: options.secretKey,
      baseUrl: options.baseUrl || undefined,
    });
    const trace = client.trace({
      id: options.executionId,
      name: "execution",
      userId: options.userId,
      metadata: { executionId: options.executionId },
    });
    return {
      enabled: true,
      generation(model, usage, input, output, latencyMs) {
        try {
          const now = new Date();
          trace.generation({
            name: "model",
            model,
            input: redactForTelemetry(input),
            output: redactForTelemetry(output),
            startTime: latencyMs ? new Date(now.getTime() - latencyMs) : undefined,
            endTime: now,
            usage: {
              input: usage.inputTokens,
              output: usage.outputTokens,
              total: usage.inputTokens + usage.outputTokens,
            },
          });
        } catch (error) {
          logTelemetryFailure(error);
        }
      },
      toolSpan(name, input, output, latencyMs) {
        try {
          const now = new Date();
          trace.span({
            name,
            input: redactForTelemetry(input),
            output: redactForTelemetry(output),
            startTime: latencyMs ? new Date(now.getTime() - latencyMs) : undefined,
            endTime: now,
          });
        } catch (error) {
          logTelemetryFailure(error);
        }
      },
      async flush() {
        try {
          await client.flushAsync();
        } catch (error) {
          logTelemetryFailure(error);
        }
      },
    };
  } catch (error) {
    logTelemetryFailure(error);
    return noop;
  }
}

export function redactForTelemetry(value: unknown, depth = 0): unknown {
  const redacted = redact(value);
  return stripSensitive(redacted, depth);
}

function stripSensitive(value: unknown, depth: number): unknown {
  if (depth > 8) return "[truncated]";
  if (Array.isArray(value)) return value.map((item) => stripSensitive(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = SENSITIVE.test(key) ? "[redacted]" : stripSensitive(child, depth + 1);
  }
  return output;
}

function logTelemetryFailure(error: unknown) {
  const name = error instanceof Error ? error.name : "Error";
  console.warn(`langfuse ${name}`);
}
