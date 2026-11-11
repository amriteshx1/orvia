import { expireApprovals, listApprovals } from "@orvia/core/execution";
import { getWebEnv } from "@orvia/config";
import Link from "next/link";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const user = await requirePageUser();
  await expireApprovals(getWebEnv().REDIS_URL);
  const approvals = await listApprovals(user.id);
  const pending = approvals.filter((approval) => approval.status === "pending");
  const history = approvals.filter((approval) => approval.status !== "pending");

  return (
    <section>
      <h1 className="text-3xl font-semibold">Approvals</h1>
      <p className="mt-2 text-muted">Protected actions wait here until you decide.</p>
      {pending.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed border-line bg-card p-8 text-muted">
          No approvals are waiting.
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
          {pending.map((approval) => (
            <li key={approval.id}>
              <Link href={`/approvals/${approval.id}`} className="block px-5 py-4 hover:bg-paper">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="font-medium">{approval.toolName}</h2>
                  <span className="text-xs text-muted">Expires {new Date(approval.expiresAt).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-sm text-muted">{approval.agentName}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <h2 className="mt-12 text-xl font-semibold">History</h2>
      {history.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No decisions yet.</p>
      ) : (
        <ul className="mt-4 space-y-2 text-sm">
          {history.map((approval) => (
            <li key={approval.id}>
              <Link href={`/approvals/${approval.id}`}>
                {approval.toolName} · {approval.status}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
