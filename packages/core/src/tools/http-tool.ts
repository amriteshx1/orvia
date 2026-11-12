import { loadConnectionSecret } from "../connections/service";
import { safeErrorMessage } from "../execution/constants";
import { dispatchEffect, recordToolStep } from "../execution/effects";
import { EffectFailed } from "../execution/errors";
import { pinnedHttpRequest, SsrfError, type HttpHop } from "../http/ssrf";
import type { ToolCall, ToolRuntime } from "./runtime";
import { readRecord, text } from "./runtime";

const MODEL_HEADERS = /^(authorization|proxy-authorization|cookie|set-cookie|host|content-length|connection|transfer-encoding)$/i;

export async function runHttpRequest(runtime: ToolRuntime, call: ToolCall) {
  const input = readRecord(call.input);
  const method = (text(input.method, 10) || "GET").toUpperCase();
  const connectionId = text(input.connectionId, 80);
  if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method)) {
    return { ok: false, error: "invalid_input", message: "That HTTP method is not allowed." };
  }
  if (method !== "GET" && !connectionId) {
    return { ok: false, error: "connection_required", message: "A non-GET request needs a saved connection." };
  }
  try {
    if (method === "GET") return await performRead(runtime, call, method, connectionId);
    return await performWrite(runtime, call, method, connectionId);
  } catch (error) {
    if (error instanceof SsrfError) {
      const output = { ok: false, error: "ssrf_blocked", message: safeErrorMessage("ssrf_blocked") };
      await recordToolStep(runtime.fence, "http_request", safeInput(input), output);
      return output;
    }
    throw error;
  }
}

async function performRead(runtime: ToolRuntime, call: ToolCall, method: string, connectionId: string) {
  const prepared = await prepare(runtime, call.input, connectionId, null);
  if ("error" in prepared) return prepared.error;
  const response = await pinnedHttpRequest({
    url: prepared.url,
    method,
    headers: prepared.headers,
    timeoutMs: runtime.httpTimeoutMs,
    maxBytes: runtime.httpMaxResponseBytes,
    allowHost: (hostname) => hostAllowed(hostname, prepared.allowlist, prepared.allowEmpty),
  });
  const output = present(response.status, response.body, response.truncated, response.finalUrl, response.hops);
  await recordToolStep(runtime.fence, "http_request", safeInput(readRecord(call.input)), output);
  return output;
}

async function performWrite(runtime: ToolRuntime, call: ToolCall, method: string, connectionId: string) {
  const loaded = await loadGranted(runtime, connectionId, "http");
  if ("error" in loaded) return loaded;
  const idempotencyKey = loaded.config.honorsIdempotencyKey ? `orvia-${call.toolCallId}` : null;
  try {
    return await dispatchEffect({
      fence: runtime.fence,
      toolCallId: call.toolCallId,
      toolName: "http_request",
      input: safeInput(readRecord(call.input)),
      idempotencyKey,
      signal: call.signal,
      perform: async ({ idempotencyKey: key }) => {
        const prepared = await prepare(runtime, call.input, connectionId, key);
        if ("error" in prepared) throw new EffectFailed();
        let response;
        try {
          response = await pinnedHttpRequest({
            url: prepared.url,
            method,
            headers: prepared.headers,
            body: text(readRecord(call.input).body, 100_000) || undefined,
            timeoutMs: runtime.httpTimeoutMs,
            maxBytes: runtime.httpMaxResponseBytes,
            followRedirects: false,
            allowHost: (hostname) => hostAllowed(hostname, prepared.allowlist, prepared.allowEmpty),
          });
        } catch (error) {
          if (error instanceof SsrfError) throw new EffectFailed();
          throw error;
        }
        if (response.status === 408 || response.status === 429 || response.status >= 500) {
          throw new Error("ambiguous_http");
        }
        if (response.status >= 400) throw new EffectFailed();
        return present(response.status, response.body, response.truncated, response.finalUrl, response.hops);
      },
    });
  } catch (error) {
    if (error instanceof EffectFailed) {
      return { ok: false, error: "effect_failed", message: safeErrorMessage("effect_failed") };
    }
    throw error;
  }
}

async function prepare(runtime: ToolRuntime, input: unknown, connectionId: string, idempotencyKey: string | null) {
  const body = readRecord(input);
  const modelHeaders = modelHeaderMap(body.headers);
  if (!connectionId) {
    const url = absoluteUrl(text(body.url, 2_000), null);
    if (!url) return { error: { ok: false, error: "invalid_input", message: "A public http or https URL is required." } };
    if (!hostAllowed(url.hostname, runtime.snapshot.httpAllowedDomains, true)) {
      return { error: { ok: false, error: "not_allowlisted", message: "That host is not on the public HTTP allowlist." } };
    }
    return { url: withQuery(url, body.query).toString(), headers: modelHeaders, allowlist: runtime.snapshot.httpAllowedDomains, allowEmpty: true };
  }
  const loaded = await loadGranted(runtime, connectionId, "http");
  if ("error" in loaded) return { error: loaded };
  const url = absoluteUrl(text(body.url, 2_000), loaded.config.baseUrl ?? null);
  if (!url) return { error: { ok: false, error: "invalid_input", message: "A URL or path is required." } };
  const allowed = loaded.config.allowedDomains ?? [];
  if (!hostAllowed(url.hostname, allowed, false)) {
    return { error: { ok: false, error: "not_allowlisted", message: "That host is not on the connection allowlist." } };
  }
  const headers = { ...modelHeaders, ...(loaded.secret.headers ?? {}) };
  if (idempotencyKey) headers[(loaded.config.idempotencyHeader || "Idempotency-Key").toLowerCase()] = idempotencyKey;
  return { url: withQuery(url, body.query).toString(), headers, allowlist: allowed, allowEmpty: false };
}

async function loadGranted(runtime: ToolRuntime, connectionId: string, provider: "http" | "github" | "gmail") {
  const granted =
    provider === "http"
      ? runtime.snapshot.httpConnectionIds.includes(connectionId)
      : provider === "github"
        ? runtime.snapshot.githubConnectionId === connectionId
        : runtime.snapshot.gmailConnectionId === connectionId;
  if (!granted) return { ok: false as const, error: "connection_unavailable", message: safeErrorMessage("connection_unavailable") };
  const loaded = await loadConnectionSecret({
    userId: runtime.userId,
    connectionId,
    provider,
    encryptionKeyHex: runtime.credentialsKey,
    githubClientId: runtime.githubClientId,
    githubClientSecret: runtime.githubClientSecret,
    googleClientId: runtime.googleClientId,
    googleClientSecret: runtime.googleClientSecret,
  });
  if ("error" in loaded) {
    return { ok: false as const, error: loaded.error, message: safeErrorMessage(loaded.error) };
  }
  return loaded;
}

function present(status: number, body: string, truncated: boolean, finalUrl: string, hops: HttpHop[]) {
  return {
    ok: status >= 200 && status < 300,
    status,
    finalUrl,
    remoteAddress: hops.at(-1)?.address ?? null,
    hops,
    truncated,
    body: body.slice(0, 100_000),
  };
}

function absoluteUrl(value: string, base: string | null): URL | null {
  try {
    if (value.startsWith("http://") || value.startsWith("https://")) return new URL(value);
    if (!base) return null;
    return new URL(value, base.endsWith("/") ? base : `${base}/`);
  } catch {
    return null;
  }
}

function withQuery(url: URL, query: unknown): URL {
  const next = new URL(url.toString());
  const record = readRecord(query);
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") next.searchParams.set(key, value);
  }
  return next;
}

function hostAllowed(hostname: string, allowlist: string[], emptyMeansPublic: boolean): boolean {
  if (allowlist.length === 0) return emptyMeansPublic;
  const host = hostname.toLowerCase();
  return allowlist.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function modelHeaderMap(value: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(readRecord(value))) {
    if (typeof headerValue !== "string" || MODEL_HEADERS.test(key)) continue;
    headers[key.toLowerCase()] = headerValue.slice(0, 500);
  }
  return headers;
}

function safeInput(input: Record<string, unknown>) {
  return {
    url: input.url ?? null,
    method: input.method ?? "GET",
    connectionId: input.connectionId ?? null,
    query: input.query ?? null,
    body: input.body ?? null,
  };
}

export { loadGranted };
