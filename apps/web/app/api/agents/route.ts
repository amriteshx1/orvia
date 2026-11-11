import { getWebEnv } from "@orvia/config";
import { createAgent, listAgents } from "@orvia/core/agents";
import { agentErrorResponse } from "@/lib/http";
import { requireRequestUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ agents: await listAgents(user.id) });
}

export async function POST(request: Request) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const agent = await createAgent(user.id, body, getWebEnv().openAiModel);
    return Response.json({ agent }, { status: 201 });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
