import { getWebEnv } from "@orvia/config";
import { defaultSnapshot } from "@orvia/core/agents";
import { AgentForm } from "@/components/agent-form";

export const dynamic = "force-dynamic";

export default function NewAgentPage() {
  const env = getWebEnv();
  const initial = defaultSnapshot(env.openAiModel, {
    maxSteps: env.defaultMaxSteps,
    wallClockMs: env.defaultMaxWallClockMs,
    tokenBudget: env.defaultAgentTokenBudget,
  });
  return (
    <section>
      <h1 className="text-3xl font-semibold">New agent</h1>
      <AgentForm mode="create" initial={initial} />
    </section>
  );
}
