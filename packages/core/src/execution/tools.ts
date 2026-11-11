import { tool } from "ai";
import { z } from "zod";
import { truncateToolResult } from "../truncate";
import { dispatchEffect } from "./effects";
import { EffectUncertain, LeaseLost } from "./errors";
import type { Fence } from "./lease";

export function createFixtureTool(input: {
  fence: Fence;
  outputs: Map<string, unknown>;
  onFatal: (code: "effect_uncertain" | "effect_failed") => void;
  onLostLease: () => void;
}) {
  return tool({
    description:
      "Record a local fixture action. Use this when the user asks for the fixture action. It does not contact an external service.",
    inputSchema: z.object({
      action: z.string().min(1).max(200),
      payload: z.string().max(4_000),
    }),
    execute: async ({ action, payload }, options) => {
      try {
        const result = await dispatchEffect({
          fence: input.fence,
          toolCallId: options.toolCallId,
          toolName: "fixture_action",
          input: { action, payload },
          idempotencyKey: null,
          signal: options.abortSignal,
          perform: async () => ({ ok: true, action, payload }),
        });
        input.outputs.set(options.toolCallId, result);
        return truncateToolResult(result);
      } catch (error) {
        if (error instanceof LeaseLost) {
          input.onLostLease();
          throw error;
        }
        if (error instanceof EffectUncertain) input.onFatal("effect_uncertain");
        else input.onFatal("effect_failed");
        throw error;
      }
    },
  });
}
