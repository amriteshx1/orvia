import { getExecution } from "@orvia/core/execution";
import { NotFoundError } from "@orvia/core/agents";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CancelExecution } from "@/components/cancel-execution";
import { ExecutionRefresher } from "@/components/execution-refresher";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const active = new Set(["queued", "running", "waitingApproval"]);

export default async function ExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  let execution: Awaited<ReturnType<typeof getExecution>>;
  try {
    execution = await getExecution(user.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const duration = formatDuration(execution.startedAt, execution.finishedAt);

  return (
    <section>
      <ExecutionRefresher id={execution.id} active={active.has(execution.status)} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            <Link href={`/agents/${execution.agentId}`}>{execution.agentName}</Link> · v
            {execution.versionNumber}
          </p>
          <h1 className="mt-2 text-3xl font-semibold capitalize">{execution.status}</h1>
        </div>
        {active.has(execution.status) ? <CancelExecution id={execution.id} /> : null}
      </div>
      <p className="mt-4 whitespace-pre-wrap rounded-2xl border border-line bg-card px-5 py-4">{execution.task}</p>
      {execution.errorMessage ? (
        <p className="mt-4 rounded-xl bg-card px-4 py-3 text-sm text-danger">{execution.errorMessage}</p>
      ) : null}
      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">Duration</dt>
          <dd>{duration ?? "Not started"}</dd>
        </div>
        <div>
          <dt className="text-muted">Tokens</dt>
          <dd>
            {execution.inputTokens} in · {execution.outputTokens} out · {execution.cachedTokens} cached ·{" "}
            {execution.reasoningTokens} reasoning
          </dd>
        </div>
        <div>
          <dt className="text-muted">Estimated cost</dt>
          <dd>
            {execution.estimatedCostUsd === null ? "Unavailable" : `$${execution.estimatedCostUsd.toFixed(6)}`}
            {execution.longContext ? " Standard rate; long-context pricing may be higher." : ""}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Budget hold</dt>
          <dd>
            {execution.budgetHoldStatus} · {execution.budgetReservedTokens} reserved
          </dd>
        </div>
        <div>
          <dt className="text-muted">Lease</dt>
          <dd>
            {execution.leaseOwner
              ? `${execution.leaseOwner} · fence ${execution.fencingToken}`
              : `No holder · fence ${execution.fencingToken}`}
          </dd>
        </div>
      </dl>
      {execution.finalText ? (
        <div className="mt-8">
          <h2 className="text-xl font-semibold">Result</h2>
          <pre className="mt-3 overflow-auto whitespace-pre-wrap rounded-2xl bg-card p-4 text-sm">
            {execution.finalText}
          </pre>
        </div>
      ) : null}
      <div className="mt-10">
        <h2 className="text-xl font-semibold">Timeline</h2>
        {execution.steps.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No steps yet.</p>
        ) : (
          <ol className="mt-4 space-y-4">
            {execution.steps.map((step) => (
              <li key={step.id} className="rounded-2xl border border-line bg-card px-5 py-4">
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="font-medium">
                    {step.kind}
                    {step.toolName ? ` · ${step.toolName}` : ""}
                  </span>
                  <span className="text-muted">
                    {step.latencyMs !== null ? `${step.latencyMs} ms` : new Date(step.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                {step.inputTokens !== null ? (
                  <p className="mt-2 text-xs text-muted">
                    {step.inputTokens} in · {step.outputTokens} out · {step.cachedTokens} cached ·{" "}
                    {step.reasoningTokens} reasoning
                  </p>
                ) : null}
                {step.input ? <JsonBlock label="Input" value={step.input} /> : null}
                {step.output ? <JsonBlock label="Output" value={step.output} /> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
      {execution.approvals.length > 0 ? (
        <div className="mt-10">
          <h2 className="text-xl font-semibold">Approvals</h2>
          <ul className="mt-4 space-y-3">
            {execution.approvals.map((approval) => (
              <li key={approval.id} className="rounded-2xl border border-line bg-card px-5 py-4 text-sm">
                <Link href={`/approvals/${approval.id}`} className="font-medium">
                  {approval.toolName}
                </Link>
                <p className="mt-1 text-muted">
                  {approval.status}
                  {approval.decidedBy ? ` · ${approval.decidedBy}` : ""}
                  {approval.decidedAt ? ` · ${new Date(approval.decidedAt).toLocaleString()}` : ""}
                </p>
                {approval.comment ? <p className="mt-2">{approval.comment}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="mt-3">
      <p className="text-xs text-muted">{label}</p>
      <pre className="mt-1 overflow-auto whitespace-pre-wrap text-sm">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

function formatDuration(startedAt: string | null, finishedAt: string | null): string | null {
  if (!startedAt) return null;
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - new Date(startedAt).getTime()) / 1000));
  return `${seconds}s`;
}
