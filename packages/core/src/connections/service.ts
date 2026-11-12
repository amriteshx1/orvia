import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@orvia/db";
import { NotFoundError, ValidationError } from "../agents/schema";
import { decryptJson, encryptJson, parseEncryptionKey, type SecretPayload } from "../secrets";

export type PublicConnection = {
  id: string;
  provider: "http" | "github" | "gmail" | "slack";
  label: string;
  status: "active" | "revoked" | "error";
  scopes: string[];
  externalAccountId: string | null;
  tokenExpiresAt: string | null;
  config: {
    baseUrl?: string;
    allowedDomains?: string[];
    honorsIdempotencyKey?: boolean;
    idempotencyHeader?: string;
  };
  createdAt: string;
};

export type OAuthApp = {
  clientId?: string;
  clientSecret?: string;
  appUrl: string;
};

const GMAIL_READ = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_COMPOSE = "https://www.googleapis.com/auth/gmail.compose";

export async function listConnections(userId: string): Promise<PublicConnection[]> {
  const rows = await prisma.connection.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toPublic);
}

export async function createHttpConnection(
  userId: string,
  value: unknown,
  encryptionKeyHex: string | undefined,
) {
  const key = requireKey(encryptionKeyHex);
  const input = parseHttpInput(value);
  const secret = encryptJson({ headers: input.headers }, key);
  const connection = await prisma.connection.create({
    data: {
      userId,
      provider: "http",
      label: input.label,
      status: "active",
      scopes: [],
      config: {
        baseUrl: input.baseUrl,
        allowedDomains: input.allowedDomains,
        honorsIdempotencyKey: input.honorsIdempotencyKey,
        idempotencyHeader: input.idempotencyHeader,
      },
      secret: { create: { userId, ...secret } },
    },
  });
  return toPublic(connection);
}

export async function disconnectConnection(userId: string, connectionId: string) {
  const existing = await prisma.connection.findFirst({ where: { id: connectionId, userId } });
  if (!existing) throw new NotFoundError();
  await prisma.$transaction(async (tx) => {
    await tx.secret.deleteMany({ where: { connectionId: existing.id, userId } });
    await tx.connection.update({
      where: { id: existing.id },
      data: { status: "revoked", tokenExpiresAt: null },
    });
  });
}

export async function beginOAuth(input: {
  userId: string;
  provider: "github" | "gmail";
  access: "read" | "send";
  app: OAuthApp;
}) {
  if (!input.app.clientId || !input.app.clientSecret) {
    throw new ValidationError([{ path: "oauth", message: "This provider's OAuth credentials are not configured" }]);
  }
  const scopes =
    input.provider === "github"
      ? ["read:user", "repo"]
      : input.access === "send"
        ? [GMAIL_READ, GMAIL_SEND, GMAIL_COMPOSE]
        : [GMAIL_READ];
  const state = randomBytes(24).toString("base64url");
  const codeVerifier = input.provider === "gmail" ? randomBytes(32).toString("base64url") : null;
  await prisma.oauthState.create({
    data: {
      userId: input.userId,
      provider: input.provider,
      state,
      codeVerifier,
      scopes,
      label: input.provider === "github" ? "GitHub" : input.access === "send" ? "Gmail send" : "Gmail read",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });
  const redirectUri = callbackUrl(input.app.appUrl, input.provider);
  if (input.provider === "github") {
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", input.app.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("state", state);
    return url.toString();
  }
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", input.app.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", sha256(codeVerifier ?? ""));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function completeOAuth(input: {
  userId: string;
  provider: "github" | "gmail";
  state: string;
  code: string;
  app: OAuthApp;
  encryptionKeyHex?: string;
}) {
  const key = requireKey(input.encryptionKeyHex);
  if (!input.app.clientId || !input.app.clientSecret) {
    throw new ValidationError([{ path: "oauth", message: "This provider's OAuth credentials are not configured" }]);
  }
  const consumed = await prisma.$transaction(async (tx) => {
    const updated = await tx.oauthState.updateMany({
      where: {
        userId: input.userId,
        provider: input.provider,
        state: input.state,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });
    if (updated.count !== 1) return null;
    return tx.oauthState.findFirst({ where: { state: input.state, userId: input.userId } });
  });
  if (!consumed) {
    throw new ValidationError([{ path: "state", message: "This connection attempt has already been used or has expired" }]);
  }
  const redirectUri = callbackUrl(input.app.appUrl, input.provider);
  const tokens =
    input.provider === "github"
      ? await exchangeGithub(input.app, input.code, redirectUri)
      : await exchangeGoogle(input.app, input.code, redirectUri, consumed.codeVerifier);
  const identity =
    input.provider === "github" ? await githubIdentity(tokens.accessToken) : await gmailIdentity(tokens.accessToken);
  const secret = encryptJson(
    {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: tokens.tokenType,
    },
    key,
  );
  const connection = await prisma.connection.create({
    data: {
      userId: input.userId,
      provider: input.provider,
      label: identity.label || consumed.label,
      status: "active",
      scopes: consumed.scopes,
      externalAccountId: identity.id,
      tokenExpiresAt: tokens.expiresAt,
      config: {},
      secret: { create: { userId: input.userId, ...secret } },
    },
  });
  return toPublic(connection);
}

export async function loadConnectionSecret(input: {
  userId: string;
  connectionId: string;
  provider: "http" | "github" | "gmail";
  encryptionKeyHex?: string;
  githubClientId?: string;
  githubClientSecret?: string;
  googleClientId?: string;
  googleClientSecret?: string;
}): Promise<{ secret: SecretPayload; config: PublicConnection["config"]; scopes: string[] } | { error: string }> {
  const key = parseEncryptionKey(input.encryptionKeyHex);
  if (!key) return { error: "encryption_unconfigured" };
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM connection
        WHERE id = CAST(${input.connectionId} AS uuid) AND "userId" = ${input.userId}
        FOR UPDATE
      `;
      if (rows.length !== 1) return { error: "connection_unavailable" };
      const connection = await tx.connection.findFirst({
        where: { id: input.connectionId, userId: input.userId },
        include: { secret: true },
      });
      if (!connection || connection.status !== "active" || connection.provider !== input.provider || !connection.secret) {
        return { error: "connection_unavailable" };
      }
      let payload: SecretPayload;
      try {
        payload = decryptJson(connection.secret, key);
      } catch {
        return { error: "encryption_unconfigured" };
      }
      const expiring =
        connection.tokenExpiresAt !== null && connection.tokenExpiresAt.getTime() <= Date.now() + 60_000;
      if (expiring && payload.refreshToken && (input.provider === "github" || input.provider === "gmail")) {
        const refreshed =
          input.provider === "github"
            ? await refreshGithub(input.githubClientId, input.githubClientSecret, payload.refreshToken)
            : await refreshGoogle(input.googleClientId, input.googleClientSecret, payload.refreshToken);
        if (!refreshed) return { error: "connection_unavailable" };
        payload = {
          ...payload,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken || payload.refreshToken,
          tokenType: refreshed.tokenType,
        };
        const sealed = encryptJson(payload, key);
        await tx.secret.update({
          where: { connectionId: connection.id },
          data: sealed,
        });
        await tx.connection.update({
          where: { id: connection.id },
          data: { tokenExpiresAt: refreshed.expiresAt },
        });
      }
      return {
        secret: payload,
        config: readConfig(connection.config),
        scopes: connection.scopes,
      };
    },
    { timeout: 20_000 },
  );
}

export function callbackUrl(appUrl: string, provider: "github" | "gmail"): string {
  const path = provider === "github" ? "/api/connections/github/callback" : "/api/connections/google/callback";
  return new URL(path, appUrl).toString();
}

function requireKey(hex: string | undefined) {
  const key = parseEncryptionKey(hex);
  if (!key) {
    throw new ValidationError([
      { path: "CREDENTIALS_ENCRYPTION_KEY", message: "Set a 32-byte hex encryption key before saving secrets" },
    ]);
  }
  return key;
}

function parseHttpInput(value: unknown) {
  const body = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
  const domains = Array.isArray(body.allowedDomains)
    ? body.allowedDomains.filter((item): item is string => typeof item === "string")
    : typeof body.allowedDomains === "string"
      ? body.allowedDomains.split(/[,\s]+/)
      : [];
  const allowedDomains = [...new Set(domains.map((item) => item.trim().toLowerCase()).filter(Boolean))];
  const headerLines = typeof body.headers === "string" ? body.headers : "";
  const headers = parseHeaderLines(headerLines);
  if (!label || label.length > 80) {
    throw new ValidationError([{ path: "label", message: "A label is required" }]);
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ValidationError([{ path: "baseUrl", message: "Enter an https base URL" }]);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new ValidationError([{ path: "baseUrl", message: "The base URL must be https" }]);
  }
  if (allowedDomains.length === 0 || allowedDomains.some((domain) => !/^[a-z0-9.-]+$/.test(domain))) {
    throw new ValidationError([{ path: "allowedDomains", message: "Enter at least one public domain" }]);
  }
  if (Object.keys(headers).length === 0) {
    throw new ValidationError([{ path: "headers", message: "Enter the secret headers for this connection" }]);
  }
  return {
    label,
    baseUrl: parsed.origin,
    allowedDomains,
    honorsIdempotencyKey: body.honorsIdempotencyKey === true,
    idempotencyHeader:
      typeof body.idempotencyHeader === "string" && body.idempotencyHeader.trim()
        ? body.idempotencyHeader.trim()
        : "Idempotency-Key",
    headers,
  };
}

function parseHeaderLines(value: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf(":");
    if (index <= 0) continue;
    const name = trimmed.slice(0, index).trim();
    const headerValue = trimmed.slice(index + 1).trim();
    if (!name || !headerValue) continue;
    if (/^(host|content-length|transfer-encoding|connection)$/i.test(name)) continue;
    headers[name] = headerValue;
  }
  return headers;
}

async function exchangeGithub(app: OAuthApp, code: string, redirectUri: string) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const body = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string; error?: string };
  if (!response.ok || !body.access_token) {
    throw new ValidationError([{ path: "oauth", message: "GitHub did not return a token" }]);
  }
  return tokenResult(body);
}

async function exchangeGoogle(app: OAuthApp, code: string, redirectUri: string, verifier: string | null) {
  const form = new URLSearchParams({
    client_id: app.clientId ?? "",
    client_secret: app.clientSecret ?? "",
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  if (verifier) form.set("code_verifier", verifier);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const body = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string };
  if (!response.ok || !body.access_token) {
    throw new ValidationError([{ path: "oauth", message: "Google did not return a token" }]);
  }
  return tokenResult(body);
}

async function refreshGithub(clientId: string | undefined, clientSecret: string | undefined, refreshToken: string) {
  if (!clientId || !clientSecret) return null;
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  const body = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string };
  if (!response.ok || !body.access_token) return null;
  return tokenResult(body);
}

async function refreshGoogle(clientId: string | undefined, clientSecret: string | undefined, refreshToken: string) {
  if (!clientId || !clientSecret) return null;
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const body = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string };
  if (!response.ok || !body.access_token) return null;
  return tokenResult(body);
}

function tokenResult(body: { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string }) {
  return {
    accessToken: body.access_token ?? "",
    refreshToken: body.refresh_token,
    tokenType: body.token_type ?? "Bearer",
    expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : null,
  };
}

async function githubIdentity(token: string) {
  const response = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "orvia" },
  });
  if (!response.ok) return { id: null, label: "GitHub" };
  const body = (await response.json()) as { id?: number; login?: string };
  return { id: body.login ?? (body.id ? String(body.id) : null), label: body.login ?? "GitHub" };
}

async function gmailIdentity(token: string) {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) return { id: null, label: "Gmail" };
  const body = (await response.json()) as { emailAddress?: string };
  return { id: body.emailAddress ?? null, label: body.emailAddress ?? "Gmail" };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function toPublic(row: {
  id: string;
  provider: PublicConnection["provider"];
  label: string;
  status: PublicConnection["status"];
  scopes: string[];
  externalAccountId: string | null;
  tokenExpiresAt: Date | null;
  config: unknown;
  createdAt: Date;
}): PublicConnection {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    status: row.status,
    scopes: row.scopes,
    externalAccountId: row.externalAccountId,
    tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
    config: readConfig(row.config),
    createdAt: row.createdAt.toISOString(),
  };
}

function readConfig(value: unknown): PublicConnection["config"] {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    baseUrl: typeof record.baseUrl === "string" ? record.baseUrl : undefined,
    allowedDomains: Array.isArray(record.allowedDomains)
      ? record.allowedDomains.filter((item): item is string => typeof item === "string")
      : undefined,
    honorsIdempotencyKey: record.honorsIdempotencyKey === true,
    idempotencyHeader: typeof record.idempotencyHeader === "string" ? record.idempotencyHeader : undefined,
  };
}
