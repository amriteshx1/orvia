import { getApproval, submitApprovalDecision } from "@orvia/core/execution";
import { agentErrorResponse } from "@/lib/http";
import { executionRuntime } from "@/lib/runtime";
import { requireRequestUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await context.params;
    return Response.json({ approval: await getApproval(user.id, id) });
  } catch (error) {
    return agentErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { decision?: unknown; comment?: unknown };
    const approval = await submitApprovalDecision({
      userId: user.id,
      approvalId: id,
      decision: body.decision,
      comment: body.comment,
      runtime: executionRuntime(),
    });
    return Response.json({ approval });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
