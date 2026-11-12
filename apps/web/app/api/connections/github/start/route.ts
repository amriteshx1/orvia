import { beginOAuth } from "@orvia/core/connections";
import { integrationApp } from "@/lib/integrations";
import { requireRequestUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await requireRequestUser(request);
  const app = integrationApp();
  if (!user) return Response.redirect(new URL("/sign-in", app.env.appUrl));
  try {
    const url = await beginOAuth({ userId: user.id, provider: "github", access: "read", app: app.github });
    return Response.redirect(url);
  } catch {
    return Response.redirect(new URL("/connections?error=oauth_unconfigured", app.env.appUrl));
  }
}
