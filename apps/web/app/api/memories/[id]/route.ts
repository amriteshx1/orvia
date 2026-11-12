import { deleteMemory, getMemory, reviseUserMemory, setMemoryStatus } from "@orvia/core/memory";
import { agentErrorResponse } from "@/lib/http";
import { integrationApp } from "@/lib/integrations";
import { requireRequestUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const body = (await request.json()) as { status?: unknown; content?: unknown };
  const settings = integrationApp();
  try {
    if (body.status === "accepted" || body.status === "rejected") {
      const memory = await setMemoryStatus({ userId: user.id, memoryId: id, status: body.status });
      if (!memory) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json({ memory });
    }
    if (typeof body.content === "string") {
      const memory = await reviseUserMemory({
        userId: user.id,
        memoryId: id,
        content: body.content,
        apiKey: settings.env.openAiApiKey,
        embeddingModel: settings.env.openAiEmbeddingModel,
        caps: settings.caps,
      });
      return Response.json({ memory });
    }
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  } catch (error) {
    return agentErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const memory = await getMemory(user.id, id);
  if (!memory) return Response.json({ error: "Not found" }, { status: 404 });
  const deleted = await deleteMemory({ userId: user.id, agentId: memory.agentId, memoryId: id });
  if (!deleted) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
