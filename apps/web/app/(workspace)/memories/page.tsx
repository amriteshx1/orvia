import { listAgents } from "@orvia/core/agents";
import { listMemories } from "@orvia/core/memory";
import Link from "next/link";
import { MemoryActions } from "@/components/memory-actions";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function MemoriesPage({ searchParams }: { searchParams: Promise<{ agentId?: string }> }) {
  const user = await requirePageUser();
  const query = await searchParams;
  const [agents, memories] = await Promise.all([
    listAgents(user.id),
    listMemories(user.id, query.agentId),
  ]);
  const names = new Map(agents.map((agent) => [agent.id, agent.name]));

  return (
    <section>
      <h1 className="text-3xl font-semibold">Memories</h1>
      <p className="mt-2 text-sm text-muted">Proposed memories stay out of retrieval until you accept them.</p>
      <form className="mt-4" method="get">
        <label className="text-sm">
          Agent
          <select className="mt-1" name="agentId" defaultValue={query.agentId ?? ""}>
            <option value="">All</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="ml-3 rounded-full border border-line px-4 py-2 text-sm">
          Filter
        </button>
      </form>
      {memories.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No memories.</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {memories.map((memory) => (
            <li key={memory.id} className="rounded-2xl border border-line bg-card px-5 py-4">
              <p className="text-sm text-muted">
                <Link href={`/agents/${memory.agentId}`}>{names.get(memory.agentId) ?? "Agent"}</Link> · {memory.status} · {memory.createdBy}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm">{memory.content}</p>
              <MemoryActions id={memory.id} content={memory.content} status={memory.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
