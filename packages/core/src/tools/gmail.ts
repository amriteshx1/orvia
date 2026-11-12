import { loadConnectionSecret } from "../connections/service";
import { safeErrorMessage } from "../execution/constants";
import { dispatchEffect, recordToolStep } from "../execution/effects";
import { EffectFailed } from "../execution/errors";
import type { ToolCall, ToolRuntime } from "./runtime";
import { readRecord, text } from "./runtime";

const SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";

export async function runGmail(runtime: ToolRuntime, call: ToolCall) {
  const loaded = await gmailToken(runtime);
  if ("error" in loaded) return loaded;
  const input = readRecord(call.input);
  if (call.toolName === "gmail_search") return searchMail(runtime, loaded.token, text(input.query, 500) || "in:inbox");
  if (call.toolName === "gmail_read") return readMail(runtime, loaded.token, text(input.id, 200));
  if (call.toolName === "gmail_create_draft") {
    if (!loaded.scopes.includes(COMPOSE_SCOPE) && !loaded.scopes.includes(SEND_SCOPE)) {
      return { ok: false, error: "missing_scope", message: "This Gmail connection does not include compose consent." };
    }
    return mutate(runtime, call, loaded.token, false);
  }
  if (call.toolName === "gmail_send") {
    if (!loaded.scopes.includes(SEND_SCOPE)) {
      return { ok: false, error: "missing_scope", message: "This Gmail connection does not include send consent." };
    }
    return mutate(runtime, call, loaded.token, true);
  }
  return { ok: false, error: "invalid_input", message: "Unknown Gmail tool." };
}

async function searchMail(runtime: ToolRuntime, token: string, query: string) {
  const listed = await gmailFetch(token, `users/me/messages?maxResults=5&q=${encodeURIComponent(query)}`);
  if (listed.status === 401 || listed.status === 403) return unavailable();
  if (!listed.ok) return providerError(listed.status);
  const body = (await listed.json()) as { messages?: Array<{ id?: string }> };
  const messages = [];
  for (const message of body.messages ?? []) {
    if (!message.id) continue;
    const detail = await gmailFetch(token, `users/me/messages/${encodeURIComponent(message.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
    if (!detail.ok) continue;
    const row = (await detail.json()) as { id?: string; snippet?: string; payload?: { headers?: Array<{ name?: string; value?: string }> } };
    messages.push({ id: row.id, from: header(row.payload?.headers, "From"), subject: header(row.payload?.headers, "Subject"), snippet: row.snippet ?? "" });
  }
  const output = { ok: true, query, messages };
  await recordToolStep(runtime.fence, "gmail_search", { query }, output);
  return output;
}

async function readMail(runtime: ToolRuntime, token: string, id: string) {
  if (!id) return { ok: false, error: "invalid_input", message: "A message id is required." };
  const response = await gmailFetch(token, `users/me/messages/${encodeURIComponent(id)}?format=full`);
  if (response.status === 401 || response.status === 403) return unavailable();
  if (!response.ok) return providerError(response.status);
  const body = (await response.json()) as { id?: string; snippet?: string; payload?: GmailPayload };
  const message = {
    ok: true,
    id: body.id ?? id,
    from: header(body.payload?.headers, "From"),
    to: header(body.payload?.headers, "To"),
    subject: header(body.payload?.headers, "Subject"),
    body: decodePayload(body.payload).slice(0, 20_000),
  };
  await recordToolStep(runtime.fence, "gmail_read", { id }, message);
  return message;
}

async function mutate(runtime: ToolRuntime, call: ToolCall, token: string, send: boolean) {
  const input = readRecord(call.input);
  const to = text(input.to, 500);
  const subject = text(input.subject, 500);
  const body = text(input.body, 20_000);
  if (!to || !subject || !body) return { ok: false, error: "invalid_input", message: "Recipient, subject, and body are required." };
  try {
    return await dispatchEffect({
      fence: runtime.fence,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: { to, subject, body },
      idempotencyKey: null,
      signal: call.signal,
      perform: async () => {
        const raw = encodeMessage(to, subject, body);
        const path = send ? "users/me/messages/send" : "users/me/drafts";
        const payload = send ? { raw } : { message: { raw } };
        const response = await gmailFetch(token, path, { method: "POST", body: payload });
        if (response.status >= 500 || response.status === 408 || response.status === 429) throw new Error("ambiguous");
        if (!response.ok) throw new EffectFailed();
        const created = (await response.json()) as { id?: string; message?: { id?: string } };
        return { ok: true, sent: send, id: created.id ?? created.message?.id ?? null, to, subject };
      },
    });
  } catch (error) {
    if (error instanceof EffectFailed) return { ok: false, error: "effect_failed", message: safeErrorMessage("effect_failed") };
    throw error;
  }
}

async function gmailToken(runtime: ToolRuntime) {
  const connectionId = runtime.snapshot.gmailConnectionId;
  if (!connectionId) return unavailable();
  const loaded = await loadConnectionSecret({
    userId: runtime.userId,
    connectionId,
    provider: "gmail",
    encryptionKeyHex: runtime.credentialsKey,
    googleClientId: runtime.googleClientId,
    googleClientSecret: runtime.googleClientSecret,
  });
  if ("error" in loaded || !loaded.secret.accessToken) return unavailable();
  return { token: loaded.secret.accessToken, scopes: loaded.scopes };
}

async function gmailFetch(token: string, path: string, init?: { method?: string; body?: unknown }) {
  return fetch(`https://gmail.googleapis.com/gmail/v1/${path}`, {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
}

type GmailPayload = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPayload[];
  headers?: Array<{ name?: string; value?: string }>;
};

function header(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  return headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodePayload(payload: GmailPayload | undefined): string {
  if (!payload) return "";
  if (payload.body?.data && payload.mimeType?.startsWith("text/")) return decodeBase64(payload.body.data);
  for (const part of payload.parts ?? []) {
    const textPart = decodePayload(part);
    if (textPart) return textPart;
  }
  return "";
}

function decodeBase64(value: string): string {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function encodeMessage(to: string, subject: string, body: string): string {
  const message = [`To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", body].join("\r\n");
  return Buffer.from(message).toString("base64url");
}

function unavailable() {
  return { ok: false as const, error: "connection_unavailable", message: safeErrorMessage("connection_unavailable") };
}

function providerError(status: number) {
  return { ok: false, error: "provider_rejected", status, message: "Gmail rejected the request." };
}
