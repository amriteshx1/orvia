import { getWebEnv } from "@orvia/config";
import { compareAgentVersions, getAgent, NotFoundError } from "@orvia/core/agents";
import { listExecutions } from "@orvia/core/execution";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentForm } from "@/components/agent-form";
import { RunTaskForm } from "@/components/run-task-form";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requirePageUser();
  const { id } = await params;
  const query = await searchParams;
  let agent: Awaited<ReturnType<typeof getAgent>>;
  try {
    agent = await getAgent(user.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const diff =
    query.from && query.to
      ? await compareAgentVersions(user.id, id, query.from, query.to).catch((error: unknown) => {
          if (error instanceof NotFoundError) return null;
          throw error;
        })
      : null;

  const modelNote = getWebEnv().openAiModel;
  const executions = await listExecutions(user.id, id);
  const versions = [...agent.versions].sort((left, right) => left.versionNumber - right.versionNumber);

  return (
    <section>
      <h1 className="text-3xl font-semibold">{agent.current.name}</h1>
      <p className="mt-2 text-sm text-muted">
        Version {agent.current.versionNumber}. The next save records model {modelNote}.
      </p>
      {agent.archivedAt ? (
        <p className="mt-4 rounded-xl bg-card px-4 py-3 text-sm">This agent is archived.</p>
      ) : null}
      <AgentForm
        mode="edit"
        agentId={agent.id}
        initial={agent.current}
        readOnly={Boolean(agent.archivedAt)}
      />
      <div className="mt-12 border-t border-line pt-8">
        <h2 className="text-xl font-semibold">Run</h2>
        <RunTaskForm agentId={agent.id} disabled={Boolean(agent.archivedAt)} />
        {executions.length > 0 ? (
          <ul className="mt-6 space-y-2 text-sm">
            {executions.slice(0, 5).map((execution) => (
              <li key={execution.id}>
                <Link href={`/executions/${execution.id}`}>
                  {execution.status} · {execution.task.slice(0, 80)}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="mt-12 border-t border-line pt-8">
        <h2 className="text-xl font-semibold">Versions</h2>
        <form className="mt-4 flex flex-wrap items-end gap-3" method="get">
          <label className="text-sm">
            From
            <select name="from" defaultValue={query.from ?? versions[0]?.id} className="mt-1">
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  v{version.versionNumber}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            To
            <select name="to" defaultValue={query.to ?? versions.at(-1)?.id} className="mt-1">
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  v{version.versionNumber}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-full border border-line px-4 py-2 text-sm">
            Compare versions
          </button>
        </form>
        <ol className="mt-6 space-y-2 text-sm">
          {versions.map((version) => (
            <li key={version.id}>
              v{version.versionNumber} · {new Date(version.createdAt).toLocaleString()} · {version.model}
            </li>
          ))}
        </ol>
        {diff ? (
          <div className="mt-6 space-y-4">
            <div>
              <h3 className="font-medium">Settings</h3>
              {diff.fields.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No setting changes.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {diff.fields.map((change) => (
                    <li key={change.field}>
                      {change.field}: {change.before} → {change.after}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="font-medium">Instructions</h3>
              <pre className="mt-2 overflow-auto rounded-xl bg-card p-4 text-sm">
                {diff.instructions.map((line, index) => (
                  <div key={`${line.type}-${index}`}>
                    {line.type === "add" ? "+ " : line.type === "remove" ? "- " : "  "}
                    {line.text}
                  </div>
                ))}
              </pre>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
