import { cancelExecution } from "@orvia/core/execution";
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
    return Response.json({ execution: await cancelExecution(user.id, id, executionRuntime()) });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
