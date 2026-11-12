import { getWebEnv } from "@orvia/config";
import { defaultSnapshot } from "@orvia/core/agents";
import { listConnections } from "@orvia/core/connections";
import { AgentForm } from "@/components/agent-form";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewAgentPage() {
  const user = await requirePageUser();
  const env = getWebEnv();
  const connections = await listConnections(user.id);
  const initial = defaultSnapshot(env.openAiModel, {
    maxSteps: env.defaultMaxSteps,
    wallClockMs: env.defaultMaxWallClockMs,
    tokenBudget: env.defaultAgentTokenBudget,
    maxWebSearchCalls: env.defaultMaxWebSearchCalls,
  });
  return (
    <section>
      <h1 className="text-3xl font-semibold">New agent</h1>
      <AgentForm mode="create" initial={initial} connections={connections} />
    </section>
  );
}
