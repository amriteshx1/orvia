import { startEvaluationRun } from "@orvia/core/evals";
import { agentErrorResponse } from "@/lib/http";
import { evaluationRuntime } from "@/lib/integrations";
import { requireRequestUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const body = (await request.json()) as { agentId?: unknown; versionId?: unknown };
  if (typeof body.agentId !== "string") return Response.json({ error: "An agent is required" }, { status: 400 });
  try {
    const run = await startEvaluationRun(
      user.id,
      id,
      body.agentId,
      typeof body.versionId === "string" && body.versionId ? body.versionId : undefined,
      evaluationRuntime(),
    );
    return Response.json({ run }, { status: 201 });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
