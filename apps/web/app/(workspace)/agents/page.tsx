import { listAgents } from "@orvia/core/agents";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const user = await requirePageUser();
  const agents = await listAgents(user.id);

  return (
    <section>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Agents</h1>
          <p className="mt-2 text-muted">Each agent keeps its own instructions and versions.</p>
        </div>
        <Link href="/agents/new" className="rounded-full bg-pine px-4 py-2 text-sm text-white">
          New agent
        </Link>
      </div>
      {agents.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-line bg-card p-8 text-muted">
          No agents yet.
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
          {agents.map((agent) => (
            <li key={agent.id}>
              <Link href={`/agents/${agent.id}`} className="block px-5 py-4 hover:bg-paper">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="font-medium">{agent.name}</h2>
                  <span className="text-xs text-muted">v{agent.versionNumber}</span>
                </div>
                <p className="mt-1 text-sm text-muted">{agent.description || "No description"}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
