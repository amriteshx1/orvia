import { getAgent, listAgents, NotFoundError } from "@orvia/core/agents";
import { compareRuns, getDataset } from "@orvia/core/evals";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseForm, CompareForm, DeleteCaseButton, RunForm } from "@/components/evaluation-forms";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function EvaluationDatasetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ left?: string; right?: string }>;
}) {
  const user = await requirePageUser();
  const { id } = await params;
  const query = await searchParams;
  let dataset: Awaited<ReturnType<typeof getDataset>>;
  try {
    dataset = await getDataset(user.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const agents = await listAgents(user.id);
  const detailed = await Promise.all(agents.map((agent) => getAgent(user.id, agent.id)));
  const comparison =
    query.left && query.right
      ? await compareRuns(user.id, query.left, query.right).catch((error: unknown) => {
          if (error instanceof NotFoundError) return null;
          throw error;
        })
      : null;

  return (
    <section>
      <h1 className="text-3xl font-semibold">{dataset.name}</h1>
      {dataset.description ? <p className="mt-2 text-sm text-muted">{dataset.description}</p> : null}
      <div className="mt-8">
        <h2 className="text-xl font-semibold">Cases</h2>
        {dataset.cases.length === 0 ? <p className="mt-3 text-sm text-muted">No cases yet.</p> : null}
        <ul className="mt-4 space-y-3">
          {dataset.cases.map((item) => (
            <li key={item.id} className="rounded-2xl border border-line bg-card px-5 py-4 text-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="mt-1 whitespace-pre-wrap">{item.task}</p>
                </div>
                <DeleteCaseButton datasetId={dataset.id} caseId={item.id} />
              </div>
            </li>
          ))}
        </ul>
        <CaseForm datasetId={dataset.id} />
      </div>
      <div className="mt-10">
        <h2 className="text-xl font-semibold">Run</h2>
        {detailed.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Create an agent before running this dataset.</p>
        ) : (
          <RunForm
            datasetId={dataset.id}
            agents={detailed.map((agent) => ({
              id: agent.id,
              name: agent.current.name,
              versions: agent.versions.map((version) => ({ id: version.id, versionNumber: version.versionNumber })),
            }))}
          />
        )}
      </div>
      <div className="mt-10">
        <h2 className="text-xl font-semibold">Runs</h2>
        {dataset.runs.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No runs yet.</p>
        ) : (
          <ul className="mt-4 space-y-3 text-sm">
            {dataset.runs.map((run) => (
              <li key={run.id} className="rounded-2xl border border-line bg-card px-5 py-4">
                <p className="font-medium">
                  {run.agentName} v{run.versionNumber} · {run.status}
                </p>
                <p className="mt-1 text-muted">
                  {run.passed}/{run.cases} passed · score {run.score === null ? "pending" : run.score.toFixed(2)} · $
                  {run.costUsd.toFixed(6)} · {run.averageLatencyMs === null ? "no latency" : `${run.averageLatencyMs} ms`} ·{" "}
                  {run.tools.join(", ") || "no tools"}
                </p>
              </li>
            ))}
          </ul>
        )}
        {dataset.runs.length > 1 ? (
          <CompareForm
            runs={dataset.runs.map((run) => ({
              id: run.id,
              label: `${run.agentName} v${run.versionNumber} · ${new Date(run.createdAt).toLocaleString()}`,
            }))}
          />
        ) : null}
        {comparison ? <Comparison left={comparison.left} right={comparison.right} /> : null}
      </div>
    </section>
  );
}

function Comparison({
  left,
  right,
}: {
  left: { agentName: string; versionNumber: number; score: number | null; costUsd: number; averageLatencyMs: number | null; tools: string[] };
  right: { agentName: string; versionNumber: number; score: number | null; costUsd: number; averageLatencyMs: number | null; tools: string[] };
}) {
  const rows = [
    ["Version", `${left.agentName} v${left.versionNumber}`, `${right.agentName} v${right.versionNumber}`],
    ["Score", left.score === null ? "pending" : left.score.toFixed(2), right.score === null ? "pending" : right.score.toFixed(2)],
    ["Cost", `$${left.costUsd.toFixed(6)}`, `$${right.costUsd.toFixed(6)}`],
    ["Latency", left.averageLatencyMs === null ? "pending" : `${left.averageLatencyMs} ms`, right.averageLatencyMs === null ? "pending" : `${right.averageLatencyMs} ms`],
    ["Tools", left.tools.join(", ") || "none", right.tools.join(", ") || "none"],
  ];
  return (
    <table className="mt-6 w-full text-left text-sm">
      <tbody>
        {rows.map((row) => (
          <tr key={row[0]} className="border-t border-line">
            <th className="py-2 pr-4 font-medium">{row[0]}</th>
            <td className="py-2 pr-4">{row[1]}</td>
            <td className="py-2">{row[2]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
