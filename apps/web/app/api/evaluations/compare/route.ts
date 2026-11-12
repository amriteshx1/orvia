import { compareRuns } from "@orvia/core/evals";
import { agentErrorResponse } from "@/lib/http";
import { requireRequestUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const left = url.searchParams.get("left");
  const right = url.searchParams.get("right");
  if (!left || !right) return Response.json({ error: "Choose two runs" }, { status: 400 });
  try {
    return Response.json(await compareRuns(user.id, left, right));
  } catch (error) {
    return agentErrorResponse(error);
  }
}
