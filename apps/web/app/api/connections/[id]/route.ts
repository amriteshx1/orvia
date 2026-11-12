import { disconnectConnection } from "@orvia/core/connections";
import { agentErrorResponse } from "@/lib/http";
import { requireRequestUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  try {
    await disconnectConnection(user.id, id);
    return Response.json({ ok: true });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
