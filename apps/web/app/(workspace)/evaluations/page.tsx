import { listDatasets } from "@orvia/core/evals";
import Link from "next/link";
import { DatasetForm } from "@/components/evaluation-forms";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function EvaluationsPage() {
  const user = await requirePageUser();
  const datasets = await listDatasets(user.id);

  return (
    <section>
      <h1 className="text-3xl font-semibold">Evaluations</h1>
      <p className="mt-2 text-sm text-muted">A run uses the same worker, budget, and approvals as a normal task.</p>
      <DatasetForm />
      {datasets.length === 0 ? (
        <p className="mt-8 text-sm text-muted">No datasets yet.</p>
      ) : (
        <ul className="mt-8 space-y-3">
          {datasets.map((dataset) => (
            <li key={dataset.id}>
              <Link href={`/evaluations/${dataset.id}`} className="font-medium">
                {dataset.name}
              </Link>
              <p className="text-sm text-muted">
                {dataset.cases} cases · {dataset.runs} runs
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
