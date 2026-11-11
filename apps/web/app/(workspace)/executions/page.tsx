import { listExecutions } from "@orvia/core/execution";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ExecutionsPage() {
  const user = await requirePageUser();
  const executions = await listExecutions(user.id);

  return (
    <section>
      <h1 className="text-3xl font-semibold">Executions</h1>
      <p className="mt-2 text-muted">Runs stay in history after they finish.</p>
      {executions.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-line bg-card p-8 text-muted">
          No executions yet.
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
          {executions.map((execution) => (
            <li key={execution.id}>
              <Link href={`/executions/${execution.id}`} className="block px-5 py-4 hover:bg-paper">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="font-medium">{execution.agentName}</h2>
                  <span className="text-xs text-muted">{execution.status}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{execution.task}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
