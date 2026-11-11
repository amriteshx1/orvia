import { expireApprovals, listApprovals } from "@orvia/core/execution";
import { getWebEnv } from "@orvia/config";
import { requireRequestUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await expireApprovals(getWebEnv().REDIS_URL);
  return Response.json({ approvals: await listApprovals(user.id) });
}
