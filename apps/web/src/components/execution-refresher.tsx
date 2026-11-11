"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function ExecutionRefresher({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    let poll: ReturnType<typeof setInterval> | undefined;
    const refresh = () => router.refresh();
    const source = new EventSource(`/api/executions/${id}/events`);
    source.onmessage = () => refresh();
    source.onerror = () => {
      source.close();
      poll ??= setInterval(refresh, 2_000);
    };
    return () => {
      source.close();
      if (poll) clearInterval(poll);
    };
  }, [active, id, router]);

  return null;
}
