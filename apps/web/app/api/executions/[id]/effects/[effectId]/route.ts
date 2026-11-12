import { reconcileEffect } from "@orvia/core/execution";
import { agentErrorResponse } from "@/lib/http";
import { requireRequestUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string; effectId: string }> }) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id, effectId } = await context.params;
  const body = (await request.json()) as { status?: unknown; note?: unknown };
  if (body.status !== "succeeded" && body.status !== "failed") {
    return Response.json({ error: "Choose succeeded or failed" }, { status: 400 });
  }
  try {
    const execution = await reconcileEffect({
      userId: user.id,
      executionId: id,
      effectId,
      status: body.status,
      note: typeof body.note === "string" ? body.note : "",
    });
    return Response.json({ execution });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
