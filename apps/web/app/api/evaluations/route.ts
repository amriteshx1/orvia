import { createDataset, listDatasets } from "@orvia/core/evals";
import { agentErrorResponse } from "@/lib/http";
import { requireRequestUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ datasets: await listDatasets(user.id) });
}

export async function POST(request: Request) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const dataset = await createDataset(user.id, await request.json());
    return Response.json({ dataset }, { status: 201 });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
