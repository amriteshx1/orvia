"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReconcileEffect({ executionId, effectId }: { executionId: string; effectId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(status: "succeeded" | "failed", form: HTMLFormElement) {
    setPending(true);
    setError(null);
    const note = String(new FormData(form).get("note") ?? "");
    const response = await fetch(`/api/executions/${executionId}/effects/${effectId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, note }),
    });
    setPending(false);
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setError(payload.error ?? "Could not reconcile the effect.");
      return;
    }
    router.refresh();
  }

  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <label className="block text-sm">
        What actually happened
        <input className="mt-1" name="note" disabled={pending} />
      </label>
      <div className="flex gap-3 text-sm">
        <button type="button" disabled={pending} onClick={(event) => void submit("succeeded", event.currentTarget.form!)}>
          Mark succeeded
        </button>
        <button type="button" disabled={pending} onClick={(event) => void submit("failed", event.currentTarget.form!)}>
          Mark failed
        </button>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </form>
  );
}
