import { createExecution } from "@orvia/core/execution";
import { agentErrorResponse } from "@/lib/http";
import { executionRuntime } from "@/lib/runtime";
import { requireRequestUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { task?: unknown };
    const execution = await createExecution(user.id, id, body.task, executionRuntime());
    return Response.json({ execution }, { status: 201 });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
