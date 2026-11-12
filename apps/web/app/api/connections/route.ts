import { createHttpConnection, listConnections } from "@orvia/core/connections";
import { agentErrorResponse } from "@/lib/http";
import { integrationApp } from "@/lib/integrations";
import { requireRequestUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ connections: await listConnections(user.id) });
}

export async function POST(request: Request) {
  const user = await requireRequestUser(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const connection = await createHttpConnection(user.id, await request.json(), integrationApp().env.credentialsEncryptionKey);
    return Response.json({ connection }, { status: 201 });
  } catch (error) {
    return agentErrorResponse(error);
  }
}
