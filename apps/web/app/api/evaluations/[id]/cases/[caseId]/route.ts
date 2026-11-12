import { deleteCase } from "@orvia/core/evals";
import { agentErrorResponse } from "@/lib/http";
import { requireRequestUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ id: string; caseId: string }> }) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id, caseId } = await context.params;
  try {
    return Response.json({ dataset: await deleteCase(user.id, id, caseId) });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
