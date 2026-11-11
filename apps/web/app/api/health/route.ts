import { checkHealth } from "@orvia/core";
import { getWebEnv } from "@orvia/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const env = getWebEnv();
  const report = await checkHealth(env.DATABASE_URL, env.REDIS_URL);
  return Response.json(report, { status: report.ok ? 200 : 503 });
}
