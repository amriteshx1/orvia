import { getWebEnv } from "@orvia/config";
import { archiveAgent, getAgent, updateAgent } from "@orvia/core/agents";
import { agentErrorResponse } from "@/lib/http";
import { requireRequestUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  try {
    return Response.json({ agent: await getAgent(user.id, id) });
  } catch (error) {
    return agentErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  try {
    const body = await request.json();
    const agent = await updateAgent(user.id, id, body, getWebEnv().openAiModel);
    return Response.json({ agent });
  } catch (error) {
    return agentErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  try {
    const memories = new URL(request.url).searchParams.get("memories");
    return Response.json({ agent: await archiveAgent(user.id, id, { deleteMemories: memories === "delete" }) });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
