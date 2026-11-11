import { Langfuse } from "langfuse";
import type { TokenUsage } from "./pricing";

export type RunTelemetry = {
  enabled: boolean;
  generation(model: string, usage: TokenUsage): void;
  flush(): Promise<void>;
};

const noop: RunTelemetry = {
  enabled: false,
  generation() {},
  async flush() {},
};

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
      baseUrl: options.baseUrl,
    });
    const trace = client.trace({
      id: options.executionId,
      name: "execution",
      userId: options.userId,
      metadata: { executionId: options.executionId },
    });
    return {
      enabled: true,
      generation(model, usage) {
        try {
          trace.generation({
            name: "model",
            model,
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

function logTelemetryFailure(error: unknown) {
  const name = error instanceof Error ? error.name : "Error";
  console.warn(`langfuse ${name}`);
}
