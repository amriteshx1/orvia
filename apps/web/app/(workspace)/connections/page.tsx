import { callbackUrl, listConnections } from "@orvia/core/connections";
import { DisconnectButton, HttpConnectionForm } from "@/components/connection-forms";
import { integrationApp } from "@/lib/integrations";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requirePageUser();
  const query = await searchParams;
  const settings = integrationApp();
  const connections = await listConnections(user.id);
  const githubReady = Boolean(settings.github.clientId && settings.github.clientSecret && settings.env.credentialsEncryptionKey);
  const googleReady = Boolean(settings.google.clientId && settings.google.clientSecret && settings.env.credentialsEncryptionKey);
  const encryptionReady = Boolean(settings.env.credentialsEncryptionKey);

  return (
    <section>
      <h1 className="text-3xl font-semibold">Connections</h1>
      <p className="mt-2 text-sm text-muted">
        Secrets stay encrypted and are not shown again after they are saved. A missing provider credential leaves the app running and blocks only that connection.
      </p>
      {query.error === "oauth_unconfigured" ? (
        <p className="mt-4 rounded-xl bg-card px-4 py-3 text-sm">This provider is not configured yet. Add its client id, client secret, and encryption key.</p>
      ) : null}
      {query.error === "oauth" ? (
        <p className="mt-4 rounded-xl bg-card px-4 py-3 text-sm">The connection attempt expired, was already used, or the provider declined it.</p>
      ) : null}
      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="text-xl font-semibold">GitHub</h2>
          <p className="mt-2 text-sm text-muted">OAuth App scopes: read:user and repo. Redirect {callbackUrl(settings.env.appUrl, "github")}.</p>
          {githubReady ? (
            <a className="mt-4 inline-block rounded-full bg-pine px-5 py-2.5 text-white" href="/api/connections/github/start">
              Connect GitHub
            </a>
          ) : (
            <p className="mt-4 text-sm">GitHub OAuth is not configured.</p>
          )}
        </div>
        <div>
          <h2 className="text-xl font-semibold">Gmail</h2>
          <p className="mt-2 text-sm text-muted">
            Separate read and send consent. Redirect {callbackUrl(settings.env.appUrl, "gmail")}. Enable the Gmail API in the Google project.
          </p>
          {googleReady ? (
            <div className="mt-4 flex flex-wrap gap-3">
              <a className="rounded-full bg-pine px-5 py-2.5 text-white" href="/api/connections/google/start?access=read">
                Connect Gmail read
              </a>
              <a className="rounded-full border border-line px-5 py-2.5" href="/api/connections/google/start?access=send">
                Connect Gmail send
              </a>
            </div>
          ) : (
            <p className="mt-4 text-sm">Google OAuth is not configured.</p>
          )}
        </div>
      </div>
      <div className="mt-10">
        <h2 className="text-xl font-semibold">HTTP</h2>
        {encryptionReady ? <HttpConnectionForm /> : <p className="mt-4 text-sm">Set CREDENTIALS_ENCRYPTION_KEY before saving an HTTP secret.</p>}
      </div>
      <div className="mt-10">
        <h2 className="text-xl font-semibold">Saved</h2>
        {connections.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No connections yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {connections.map((connection) => (
              <li key={connection.id} className="rounded-2xl border border-line bg-card px-5 py-4 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">{connection.label}</p>
                    <p className="mt-1 text-muted">
                      {connection.provider} · {connection.status}
                      {connection.config.baseUrl ? ` · ${connection.config.baseUrl}` : ""}
                    </p>
                    {connection.scopes.length > 0 ? <p className="mt-1 text-muted">{connection.scopes.join(", ")}</p> : null}
                  </div>
                  {connection.status === "active" ? <DisconnectButton id={connection.id} /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
