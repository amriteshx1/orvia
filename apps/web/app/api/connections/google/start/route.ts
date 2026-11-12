import { beginOAuth } from "@orvia/core/connections";
import { integrationApp } from "@/lib/integrations";
import { requireRequestUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await requireRequestUser(request);
  const app = integrationApp();
  if (!user) return Response.redirect(new URL("/sign-in", app.env.appUrl));
  const access = new URL(request.url).searchParams.get("access") === "send" ? "send" : "read";
  try {
    const url = await beginOAuth({ userId: user.id, provider: "gmail", access, app: app.google });
    return Response.redirect(url);
  } catch {
    return Response.redirect(new URL("/connections?error=oauth_unconfigured", app.env.appUrl));
  }
}
