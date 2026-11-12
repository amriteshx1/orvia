"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DatasetForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        void fetch("/api/evaluations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: data.get("name"), description: data.get("description") }),
        }).then(async (response) => {
          if (!response.ok) {
            const payload = (await response.json()) as { error?: string };
            setError(payload.error ?? "Could not create the dataset.");
            return;
          }
          const payload = (await response.json()) as { dataset: { id: string } };
          form.reset();
          router.push(`/evaluations/${payload.dataset.id}`);
        });
      }}
    >
      <label className="block text-sm">
        Name
        <input className="mt-1" name="name" required />
      </label>
      <label className="block text-sm">
        Description
        <input className="mt-1" name="description" />
      </label>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <button type="submit" className="rounded-full bg-pine px-5 py-2.5 text-white">
        Create dataset
      </button>
    </form>
  );
}

export function CaseForm({ datasetId }: { datasetId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const maxCost = String(data.get("maxCostUsd") ?? "");
        const maxLatency = String(data.get("maxLatencyMs") ?? "");
        void fetch(`/api/evaluations/${datasetId}/cases`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: data.get("name"),
            task: data.get("task"),
            contains: String(data.get("contains") ?? ""),
            expectedTools: String(data.get("expectedTools") ?? ""),
            maxCostUsd: maxCost === "" ? undefined : Number(maxCost),
            maxLatencyMs: maxLatency === "" ? undefined : Number(maxLatency),
            rubric: data.get("rubric"),
          }),
        }).then(async (response) => {
          if (!response.ok) {
            const payload = (await response.json()) as { error?: string };
            setError(payload.error ?? "Could not add the case.");
            return;
          }
          form.reset();
          setError(null);
          router.refresh();
        });
      }}
    >
      <label className="block text-sm">
        Case name
        <input className="mt-1" name="name" required />
      </label>
      <label className="block text-sm">
        Task
        <textarea className="mt-1 min-h-24" name="task" required />
      </label>
      <label className="block text-sm">
        Expected content, one phrase per line
        <textarea className="mt-1 min-h-16" name="contains" />
      </label>
      <label className="block text-sm">
        Expected tools
        <input className="mt-1" name="expectedTools" placeholder="web_search, github_user" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          Max cost (USD)
          <input className="mt-1" name="maxCostUsd" type="number" min={0} step="0.000001" />
        </label>
        <label className="block text-sm">
          Max latency (ms)
          <input className="mt-1" name="maxLatencyMs" type="number" min={0} step="1" />
        </label>
      </div>
      <label className="block text-sm">
        Rubric
        <textarea className="mt-1 min-h-16" name="rubric" />
      </label>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <button type="submit" className="rounded-full border border-line px-4 py-2 text-sm">
        Add case
      </button>
    </form>
  );
}

export function RunForm({
  datasetId,
  agents,
}: {
  datasetId: string;
  agents: Array<{ id: string; name: string; versions: Array<{ id: string; versionNumber: number }> }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void fetch(`/api/evaluations/${datasetId}/runs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentId: data.get("agentId"), versionId: data.get("versionId") }),
        }).then(async (response) => {
          if (!response.ok) {
            const payload = (await response.json()) as { error?: string };
            setError(payload.error ?? "Could not start the run.");
            return;
          }
          setError(null);
          router.refresh();
        });
      }}
    >
      <label className="text-sm">
        Agent
        <select className="mt-1" name="agentId" required>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Version
        <select className="mt-1" name="versionId">
          <option value="">Current</option>
          {agents.flatMap((agent) =>
            agent.versions.map((version) => (
              <option key={version.id} value={version.id}>
                {agent.name} v{version.versionNumber}
              </option>
            )),
          )}
        </select>
      </label>
      <button type="submit" className="rounded-full bg-pine px-4 py-2 text-sm text-white">
        Run dataset
      </button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </form>
  );
}

export function DeleteCaseButton({ datasetId, caseId }: { datasetId: string; caseId: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="text-sm text-danger"
      onClick={() => {
        void fetch(`/api/evaluations/${datasetId}/cases/${caseId}`, { method: "DELETE" }).then(() => router.refresh());
      }}
    >
      Delete case
    </button>
  );
}

export function CompareForm({ runs }: { runs: Array<{ id: string; label: string }> }) {
  return (
    <form className="mt-4 flex flex-wrap items-end gap-3" method="get">
      <label className="text-sm">
        Left
        <select className="mt-1" name="left">
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Right
        <select className="mt-1" name="right">
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="rounded-full border border-line px-4 py-2 text-sm">
        Compare
      </button>
    </form>
  );
}
