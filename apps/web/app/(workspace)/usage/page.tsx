import { getUsage } from "@orvia/core/execution";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const user = await requirePageUser();
  const usage = await getUsage(user.id);
  const budget = usage.budget;

  return (
    <section>
      <h1 className="text-3xl font-semibold">Usage</h1>
      {budget ? (
        <p className="mt-2 text-sm text-muted">
          {budget.consumedTokens.toLocaleString()} consumed · {budget.reservedTokens.toLocaleString()} reserved ·{" "}
          {budget.monthlyTokenCap.toLocaleString()} monthly cap
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted">No budget has been recorded yet.</p>
      )}
      {usage.records.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No runs yet.</p>
      ) : (
        <ul className="mt-6 space-y-3 text-sm">
          {usage.records.map((record) => (
            <li key={record.id} className="rounded-2xl border border-line bg-card px-5 py-4">
              <Link href={`/executions/${record.executionId}`} className="font-medium">
                {record.agentName} · {record.status}
              </Link>
              <p className="mt-1">{record.task.slice(0, 140)}</p>
              <p className="mt-1 text-muted">
                {record.inputTokens} in · {record.outputTokens} out · {record.embeddingTokens} embedding · {record.webSearchCalls}{" "}
                searches · {record.estimatedCostUsd === null ? "cost unavailable" : `$${record.estimatedCostUsd.toFixed(6)}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
