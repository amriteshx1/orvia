import { getDataset } from "@orvia/core/evals";
import { agentErrorResponse } from "@/lib/http";
import { requireRequestUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  try {
    return Response.json({ dataset: await getDataset(user.id, id) });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
