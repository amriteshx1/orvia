"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MemoryActions({ id, content, status }: { id: string; content: string; status: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState(content);

  async function send(body: Record<string, unknown>, method = "PATCH") {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/memories/${id}`, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "DELETE" ? undefined : JSON.stringify(body),
    });
    setPending(false);
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setError(payload.error ?? "Could not update the memory.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-3 space-y-2">
      {status === "proposed" ? (
        <div className="flex gap-3 text-sm">
          <button type="button" disabled={pending} onClick={() => void send({ status: "accepted" })}>
            Accept
          </button>
          <button type="button" disabled={pending} onClick={() => void send({ status: "rejected" })}>
            Reject
          </button>
        </div>
      ) : null}
      <textarea className="min-h-20" value={draft} onChange={(event) => setDraft(event.target.value)} disabled={pending} />
      <div className="flex gap-3 text-sm">
        <button type="button" disabled={pending} onClick={() => void send({ content: draft })}>
          Save edit
        </button>
        <button type="button" className="text-danger" disabled={pending} onClick={() => void send({}, "DELETE")}>
          Delete
        </button>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
