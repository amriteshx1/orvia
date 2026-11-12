import { listMemories } from "@orvia/core/memory";
import { requireRequestUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const agentId = new URL(request.url).searchParams.get("agentId") ?? undefined;
  return Response.json({ memories: await listMemories(user.id, agentId) });
}
