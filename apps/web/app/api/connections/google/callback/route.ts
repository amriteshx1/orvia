import { completeOAuth } from "@orvia/core/connections";
import { integrationApp } from "@/lib/integrations";
import { requireRequestUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await requireRequestUser(request);
  const app = integrationApp();
  const url = new URL(request.url);
  if (!user) return Response.redirect(new URL("/sign-in", app.env.appUrl));
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error") || !code || !state) {
    return Response.redirect(new URL("/connections?error=oauth", app.env.appUrl));
  }
  try {
    await completeOAuth({
      userId: user.id,
      provider: "gmail",
      state,
      code,
      app: app.google,
      encryptionKeyHex: app.env.credentialsEncryptionKey,
    });
    return Response.redirect(new URL("/connections", app.env.appUrl));
  } catch {
    return Response.redirect(new URL("/connections?error=oauth", app.env.appUrl));
  }
}
