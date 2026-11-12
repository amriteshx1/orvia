"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function HttpConnectionForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(form: HTMLFormElement) {
    setPending(true);
    setError(null);
    const data = new FormData(form);
    const response = await fetch("/api/connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: data.get("label"),
        baseUrl: data.get("baseUrl"),
        allowedDomains: String(data.get("allowedDomains") ?? ""),
        headers: String(data.get("headers") ?? ""),
        honorsIdempotencyKey: data.get("honorsIdempotencyKey") === "on",
        idempotencyHeader: data.get("idempotencyHeader"),
      }),
    });
    setPending(false);
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setError(payload.error ?? "Could not save the connection.");
      return;
    }
    form.reset();
    router.refresh();
  }

  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(event.currentTarget);
      }}
    >
      <label className="block text-sm">
        Label
        <input className="mt-1" name="label" required disabled={pending} />
      </label>
      <label className="block text-sm">
        HTTPS base URL
        <input className="mt-1" name="baseUrl" placeholder="https://api.example.com" required disabled={pending} />
      </label>
      <label className="block text-sm">
        Allowed domains
        <input className="mt-1" name="allowedDomains" placeholder="api.example.com" required disabled={pending} />
      </label>
      <label className="block text-sm">
        Secret headers
        <textarea className="mt-1 min-h-24" name="headers" placeholder={"Authorization: Bearer …"} required disabled={pending} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input className="h-4 w-4" type="checkbox" name="honorsIdempotencyKey" disabled={pending} />
        This API honors an idempotency key
      </label>
      <label className="block text-sm">
        Idempotency header
        <input className="mt-1" name="idempotencyHeader" defaultValue="Idempotency-Key" disabled={pending} />
      </label>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <button type="submit" disabled={pending} className="rounded-full bg-pine px-5 py-2.5 text-white disabled:opacity-60">
        Save HTTP connection
      </button>
    </form>
  );
}

export function DisconnectButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      className="text-sm text-danger"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void fetch(`/api/connections/${id}`, { method: "DELETE" }).then(() => {
          setPending(false);
          router.refresh();
        });
      }}
    >
      Disconnect
    </button>
  );
}
