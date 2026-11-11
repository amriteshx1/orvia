import { getExecution, subscribeExecution } from "@orvia/core/execution";
import { getWebEnv } from "@orvia/config";
import { NotFoundError } from "@orvia/core/agents";
import { requireRequestUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  try {
    await getExecution(user.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    throw error;
  }

  const encoder = new TextEncoder();
  let unsubscribe = async () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let last = "";
      const send = (payload: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      const tick = async () => {
        try {
          const execution = await getExecution(user.id, id);
          const snapshot = JSON.stringify({
            status: execution.status,
            steps: execution.steps.length,
            hold: execution.budgetHoldStatus,
          });
          if (snapshot !== last) {
            last = snapshot;
            send({ status: execution.status, steps: execution.steps.length });
          }
          if (execution.status !== "queued" && execution.status !== "running" && execution.status !== "waitingApproval") {
            cleanup();
          }
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        void unsubscribe();
        controller.close();
      };
      const poll = setInterval(() => {
        void tick();
      }, 2_000);
      unsubscribe = subscribeExecution(getWebEnv().REDIS_URL, id, () => {
        void tick();
      });
      void tick();
      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      void unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
