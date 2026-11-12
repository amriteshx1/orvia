import { loadConnectionSecret } from "../connections/service";
import { safeErrorMessage } from "../execution/constants";
import { dispatchEffect, recordToolStep } from "../execution/effects";
import { EffectFailed } from "../execution/errors";
import type { ToolCall, ToolRuntime } from "./runtime";
import { readRecord, text } from "./runtime";

export async function runGithub(runtime: ToolRuntime, call: ToolCall) {
  const loaded = await githubToken(runtime);
  if ("error" in loaded) return loaded;
  const input = readRecord(call.input);
  if (call.toolName === "github_user") return recorded(runtime, call.toolName, {}, githubJson(loaded.token, "GET", "/user"));
  if (call.toolName === "github_repos") {
    return recorded(runtime, call.toolName, {}, githubJson(loaded.token, "GET", "/user/repos?per_page=20&sort=updated"));
  }
  if (call.toolName === "github_read_file") {
    const owner = text(input.owner, 100);
    const repo = text(input.repo, 100);
    const path = text(input.path, 500).replace(/^\/+/, "");
    if (!owner || !repo || !path) return invalid();
    const response = await githubFetch(loaded.token, "GET", `/repos/${encode(owner)}/${encode(repo)}/contents/${path.split("/").map(encode).join("/")}`);
    if (!response.ok) return recorded(runtime, call.toolName, { owner, repo, path }, providerError(response.status));
    const body = (await response.json()) as { content?: string; encoding?: string; path?: string; sha?: string };
    const decoded = body.encoding === "base64" && body.content ? Buffer.from(body.content, "base64").toString("utf8") : "";
    return recorded(runtime, call.toolName, { owner, repo, path }, {
      ok: true,
      path: body.path ?? path,
      sha: body.sha ?? null,
      content: decoded.slice(0, 20_000),
    });
  }
  if (call.toolName !== "github_create_issue" && call.toolName !== "github_comment") return invalid();
  try {
    return await dispatchEffect({
      fence: runtime.fence,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input,
      idempotencyKey: null,
      signal: call.signal,
      perform: async () => {
        if (call.toolName === "github_create_issue") {
          const owner = text(input.owner, 100);
          const repo = text(input.repo, 100);
          const title = text(input.title, 200);
          const body = text(input.body, 20_000);
          if (!owner || !repo || !title) throw new EffectFailed();
          const response = await githubFetch(loaded.token, "POST", `/repos/${encode(owner)}/${encode(repo)}/issues`, { title, body });
          if (response.status >= 500 || response.status === 408 || response.status === 429) throw new Error("ambiguous");
          if (!response.ok) throw new EffectFailed();
          const created = (await response.json()) as { number?: number; html_url?: string };
          return { ok: true, number: created.number ?? null, url: created.html_url ?? null };
        }
        const owner = text(input.owner, 100);
        const repo = text(input.repo, 100);
        const issue = Number(input.issueNumber);
        const body = text(input.body, 20_000);
        if (!owner || !repo || !Number.isInteger(issue) || issue <= 0 || !body) throw new EffectFailed();
        const response = await githubFetch(
          loaded.token,
          "POST",
          `/repos/${encode(owner)}/${encode(repo)}/issues/${issue}/comments`,
          { body },
        );
        if (response.status >= 500 || response.status === 408 || response.status === 429) throw new Error("ambiguous");
        if (!response.ok) throw new EffectFailed();
        const created = (await response.json()) as { id?: number; html_url?: string };
        return { ok: true, id: created.id ?? null, url: created.html_url ?? null };
      },
    });
  } catch (error) {
    if (error instanceof EffectFailed) return { ok: false, error: "effect_failed", message: safeErrorMessage("effect_failed") };
    throw error;
  }
}

async function recorded(runtime: ToolRuntime, toolName: string, input: unknown, result: Promise<unknown> | unknown) {
  const output = await result;
  await recordToolStep(runtime.fence, toolName, input, output);
  return output;
}

async function githubToken(runtime: ToolRuntime) {
  const connectionId = runtime.snapshot.githubConnectionId;
  if (!connectionId) return { ok: false as const, error: "connection_unavailable", message: safeErrorMessage("connection_unavailable") };
  const loaded = await loadConnectionSecret({
    userId: runtime.userId,
    connectionId,
    provider: "github",
    encryptionKeyHex: runtime.credentialsKey,
    githubClientId: runtime.githubClientId,
    githubClientSecret: runtime.githubClientSecret,
  });
  if ("error" in loaded || !loaded.secret.accessToken) {
    return { ok: false as const, error: "connection_unavailable", message: safeErrorMessage("connection_unavailable") };
  }
  return { token: loaded.secret.accessToken };
}

async function githubJson(token: string, method: string, path: string) {
  const response = await githubFetch(token, method, path);
  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: "connection_unavailable", message: safeErrorMessage("connection_unavailable") };
  }
  if (!response.ok) return providerError(response.status);
  const body = await response.json();
  return { ok: true, data: body };
}

async function githubFetch(token: string, method: string, path: string, body?: unknown) {
  return fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "orvia",
      "x-github-api-version": "2022-11-28",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function encode(value: string): string {
  return encodeURIComponent(value);
}

function invalid() {
  return { ok: false, error: "invalid_input", message: "The GitHub tool input is incomplete." };
}

function providerError(status: number) {
  return { ok: false, error: "provider_rejected", status, message: "GitHub rejected the request." };
}
