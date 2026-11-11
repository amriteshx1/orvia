"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ApprovalDecision({ approvalId, disabled = false }: { approvalId: string; disabled?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function decide(decision: "approved" | "rejected", form: HTMLFormElement) {
    setPending(true);
    setError(null);
    const comment = String(new FormData(form).get("comment") ?? "");
    const response = await fetch(`/api/approvals/${approvalId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, comment }),
    });
    setPending(false);
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setError(payload.error ?? "Could not record the decision.");
      return;
    }
    router.refresh();
  }

  return (
    <form
      className="mt-6 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <label className="block text-sm">
        Reason
        <textarea className="mt-1 min-h-24" name="comment" disabled={disabled || pending} />
      </label>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex gap-3">
        <button
          type="button"
          disabled={disabled || pending}
          className="rounded-full bg-pine px-5 py-2.5 text-white disabled:opacity-60"
          onClick={(event) => {
            const form = event.currentTarget.form;
            if (form) void decide("approved", form);
          }}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={disabled || pending}
          className="rounded-full border border-line px-5 py-2.5 disabled:opacity-60"
          onClick={(event) => {
            const form = event.currentTarget.form;
            if (form) void decide("rejected", form);
          }}
        >
          Reject
        </button>
      </div>
    </form>
  );
}
