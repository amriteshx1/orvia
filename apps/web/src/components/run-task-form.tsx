"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RunTaskForm({ agentId, disabled = false }: { agentId: string; disabled?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setPending(true);
    setError(null);
    const task = String(new FormData(event.currentTarget).get("task") ?? "");
    const response = await fetch(`/api/agents/${agentId}/executions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task }),
    });
    setPending(false);
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setError(payload.error ?? "Could not start the run.");
      return;
    }
    const payload = (await response.json()) as { execution: { id: string } };
    router.push(`/executions/${payload.execution.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-3">
      <label className="block text-sm">
        Task
        <textarea className="mt-1 min-h-28" name="task" required disabled={disabled || pending} />
      </label>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <button
        type="submit"
        disabled={disabled || pending}
        className="rounded-full bg-pine px-5 py-2.5 text-white disabled:opacity-60"
      >
        {pending ? "Starting" : "Run task"}
      </button>
    </form>
  );
}
