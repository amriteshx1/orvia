"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CancelExecution({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      className="rounded-full border border-line px-4 py-2 text-sm disabled:opacity-60"
      onClick={() => {
        setPending(true);
        void fetch(`/api/executions/${id}/cancel`, { method: "POST" }).then(() => {
          setPending(false);
          router.refresh();
        });
      }}
    >
      Cancel run
    </button>
  );
}
