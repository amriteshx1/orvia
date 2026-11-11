import { compareAgentVersions } from "@orvia/core/agents";
import { agentErrorResponse } from "@/lib/http";
import { requireRequestUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) {
    return Response.json({ error: "from and to are required" }, { status: 400 });
  }
  try {
    return Response.json(await compareAgentVersions(user.id, id, from, to));
  } catch (error) {
    return agentErrorResponse(error);
  }
}
