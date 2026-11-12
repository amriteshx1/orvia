import { getApproval } from "@orvia/core/execution";
import { NotFoundError } from "@orvia/core/agents";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApprovalDecision } from "@/components/approval-decision";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  let approval: Awaited<ReturnType<typeof getApproval>>;
  try {
    approval = await getApproval(user.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <section>
      <p className="text-sm text-muted">
        <Link href={`/executions/${approval.executionId}`}>Execution</Link> · {approval.agentName}
      </p>
      <h1 className="mt-2 text-3xl font-semibold">{approval.toolName}</h1>
      <p className="mt-2 text-sm text-muted">
        {approval.status}
        {approval.decidedBy ? ` · ${approval.decidedBy}` : ""}
        {approval.decidedAt ? ` · ${new Date(approval.decidedAt).toLocaleString()}` : ""}
      </p>
      <p className="mt-4 text-sm text-muted">Expires {new Date(approval.expiresAt).toLocaleString()}</p>
      <ActionSummary input={approval.proposedInput} />
      <h2 className="mt-8 text-lg font-medium">Proposed action</h2>
      <pre className="mt-3 overflow-auto whitespace-pre-wrap rounded-2xl bg-card p-4 text-sm">
        {JSON.stringify(approval.proposedInput, null, 2)}
      </pre>
      <p className="mt-4 text-sm text-muted">{approval.task}</p>
      {approval.comment ? <p className="mt-4 text-sm">Reason: {approval.comment}</p> : null}
      {approval.status === "pending" ? <ApprovalDecision approvalId={approval.id} /> : null}
    </section>
  );
}

function ActionSummary({ input }: { input: unknown }) {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const to = typeof record.to === "string" ? record.to : null;
  const subject = typeof record.subject === "string" ? record.subject : null;
  if (!to && !subject) return null;
  return (
    <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
      {to ? (
        <div>
          <dt className="text-muted">To</dt>
          <dd>{to}</dd>
        </div>
      ) : null}
      {subject ? (
        <div>
          <dt className="text-muted">Subject</dt>
          <dd>{subject}</dd>
        </div>
      ) : null}
    </dl>
  );
}
