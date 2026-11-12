"use client";

import { APPROVAL_ACTIONS, TOOL_IDS, type AgentSnapshot } from "@orvia/core/agent-defaults";
import { useRouter } from "next/navigation";
import { useState } from "react";

const actionLabels: Record<(typeof APPROVAL_ACTIONS)[number], string> = {
  fixture_action: "Fixture action",
  web_search: "Web search",
  http_public_get: "Public HTTP GET",
  http_credentialed: "Credentialed HTTP",
  http_mutation: "HTTP writes",
  github_read: "GitHub read",
  github_write: "GitHub write",
  gmail_read: "Gmail read",
  gmail_send: "Gmail send",
  slack_read: "Slack read",
  slack_post: "Slack post",
  memory_search: "Memory search",
  memory_update: "Memory update",
  memory_delete: "Memory delete",
  gmail_draft: "Gmail draft",
};

type ConnectionOption = { id: string; provider: string; label: string; status: string };

export function AgentForm({
  mode,
  initial,
  agentId,
  connections = [],
  readOnly = false,
}: {
  mode: "create" | "edit";
  initial: AgentSnapshot;
  agentId?: string;
  connections?: ConnectionOption[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const enabledTools = form.getAll("enabledTools").map(String);
    const tools = Object.fromEntries(
      APPROVAL_ACTIONS.map((action) => [action, String(form.get(`approval.${action}`))]),
    );
    const body = {
      name: String(form.get("name") ?? ""),
      description: String(form.get("description") ?? ""),
      instructions: String(form.get("instructions") ?? ""),
      temperature: Number(form.get("temperature")),
      maxOutputTokens: Number(form.get("maxOutputTokens")),
      enabledTools,
      memoryEnabled: form.get("memoryEnabled") === "on",
      memoryWriteMode: String(form.get("memoryWriteMode")),
      maxSteps: Number(form.get("maxSteps")),
      maxTotalTokens: Number(form.get("maxTotalTokens")),
      wallClockMs: Number(form.get("wallClockMinutes")) * 60_000,
      maxWebSearchCalls: Number(form.get("maxWebSearchCalls")),
      webSearchAllowedDomains: domains(String(form.get("webSearchAllowedDomains") ?? "")),
      webSearchBlockedDomains: domains(String(form.get("webSearchBlockedDomains") ?? "")),
      httpAllowedDomains: domains(String(form.get("httpAllowedDomains") ?? "")),
      githubConnectionId: String(form.get("githubConnectionId") ?? "") || null,
      gmailConnectionId: String(form.get("gmailConnectionId") ?? "") || null,
      httpConnectionIds: form.getAll("httpConnectionIds").map(String),
      approvalPolicy: {
        unknown: String(form.get("approval.unknown")),
        tools,
      },
    };
    const response = await fetch(mode === "create" ? "/api/agents" : `/api/agents/${agentId}`, {
      method: mode === "create" ? "POST" : "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setPending(false);
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setError(payload.error ?? "Could not save the agent.");
      return;
    }
    const payload = (await response.json()) as { agent: { id: string } };
    if (mode === "create") router.push(`/agents/${payload.agent.id}`);
    else router.refresh();
  }

  async function archive() {
    if (!agentId || !window.confirm("Archive this agent? Past versions stay stored.")) return;
    const deleteMemories = window.confirm("Also delete this agent's memories?");
    const response = await fetch(`/api/agents/${agentId}?memories=${deleteMemories ? "delete" : "keep"}`, {
      method: "DELETE",
    });
    if (response.ok) router.push("/agents");
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-10">
      <section className="space-y-4">
        <h2 className="text-lg font-medium">Instructions</h2>
        <label className="block text-sm">
          Name
          <input className="mt-1" name="name" defaultValue={initial.name} required disabled={readOnly} />
        </label>
        <label className="block text-sm">
          Description
          <input className="mt-1" name="description" defaultValue={initial.description} disabled={readOnly} />
        </label>
        <label className="block text-sm">
          Instructions
          <textarea
            className="mt-1 min-h-40"
            name="instructions"
            defaultValue={initial.instructions}
            required
            disabled={readOnly}
          />
        </label>
        <p className="text-sm text-muted">Platform model: {initial.model}</p>
        <label className="block text-sm">
          Temperature
          <input
            className="mt-1"
            name="temperature"
            type="number"
            min={0}
            max={2}
            step="0.1"
            defaultValue={initial.temperature}
            disabled={readOnly}
          />
        </label>
        <label className="block text-sm">
          Max output tokens
          <input
            className="mt-1"
            name="maxOutputTokens"
            type="number"
            min={1}
            defaultValue={initial.maxOutputTokens}
            disabled={readOnly}
          />
        </label>
      </section>

      <fieldset className="space-y-3">
        <legend className="text-lg font-medium">Tools</legend>
        <p className="text-sm text-muted">
          New agents start with no tools. Slack is not available in this release. Gmail send always waits for approval.
        </p>
        {TOOL_IDS.map((tool) => (
          <label key={tool} className="flex items-center gap-2 text-sm">
            <input
              className="h-4 w-4"
              type="checkbox"
              name="enabledTools"
              value={tool}
              defaultChecked={initial.enabledTools.includes(tool)}
              disabled={readOnly || tool === "slack"}
            />
            {tool === "fixture" ? "Fixture action" : tool === "slack" ? "Slack (not available yet)" : tool}
          </label>
        ))}
        <label className="block text-sm">
          Web search allowed domains
          <input className="mt-1" name="webSearchAllowedDomains" defaultValue={initial.webSearchAllowedDomains.join(", ")} disabled={readOnly} />
        </label>
        <label className="block text-sm">
          Web search blocked domains
          <input className="mt-1" name="webSearchBlockedDomains" defaultValue={initial.webSearchBlockedDomains.join(", ")} disabled={readOnly} />
        </label>
        <label className="block text-sm">
          Public HTTP allowlist
          <input className="mt-1" name="httpAllowedDomains" defaultValue={initial.httpAllowedDomains.join(", ")} placeholder="Leave empty to allow any public host" disabled={readOnly} />
        </label>
        <label className="block text-sm">
          GitHub connection
          <select className="mt-1" name="githubConnectionId" defaultValue={initial.githubConnectionId ?? ""} disabled={readOnly}>
            <option value="">None</option>
            {connections.filter((item) => item.provider === "github" && item.status === "active").map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Gmail connection
          <select className="mt-1" name="gmailConnectionId" defaultValue={initial.gmailConnectionId ?? ""} disabled={readOnly}>
            <option value="">None</option>
            {connections.filter((item) => item.provider === "gmail" && item.status === "active").map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <div className="space-y-2">
          <p className="text-sm">HTTP connections</p>
          {connections.filter((item) => item.provider === "http" && item.status === "active").map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-sm">
              <input className="h-4 w-4" type="checkbox" name="httpConnectionIds" value={item.id} defaultChecked={initial.httpConnectionIds.includes(item.id)} disabled={readOnly} />
              {item.label}
            </label>
          ))}
        </div>
      </fieldset>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Memory</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            className="h-4 w-4"
            type="checkbox"
            name="memoryEnabled"
            defaultChecked={initial.memoryEnabled}
            disabled={readOnly}
          />
          Memory enabled
        </label>
        <label className="block text-sm">
          Write mode
          <select
            className="mt-1"
            name="memoryWriteMode"
            defaultValue={initial.memoryWriteMode}
            disabled={readOnly}
          >
            <option value="propose">Propose, then accept</option>
            <option value="auto">Save automatically</option>
            <option value="approval_pause">Pause for approval</option>
          </select>
        </label>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Limits</h2>
        <label className="block text-sm">
          Maximum steps
          <input
            className="mt-1"
            name="maxSteps"
            type="number"
            min={1}
            defaultValue={initial.maxSteps}
            disabled={readOnly}
          />
        </label>
        <label className="block text-sm">
          Token budget
          <input
            className="mt-1"
            name="maxTotalTokens"
            type="number"
            min={1}
            defaultValue={initial.maxTotalTokens}
            disabled={readOnly}
          />
        </label>
        <label className="block text-sm">
          Web search calls
          <input className="mt-1" name="maxWebSearchCalls" type="number" min={0} defaultValue={initial.maxWebSearchCalls} disabled={readOnly} />
        </label>
        <label className="block text-sm">
          Wall clock (minutes)
          <input
            className="mt-1"
            name="wallClockMinutes"
            type="number"
            min={1}
            defaultValue={initial.wallClockMs / 60_000}
            disabled={readOnly}
          />
        </label>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Approvals</h2>
        <label className="block text-sm">
          Unknown actions
          <select
            className="mt-1"
            name="approval.unknown"
            defaultValue={initial.approvalPolicy.unknown}
            disabled={readOnly}
          >
            <option value="auto">Allow</option>
            <option value="require_approval">Require approval</option>
            <option value="deny">Deny</option>
          </select>
        </label>
        {APPROVAL_ACTIONS.map((action) => (
          <label key={action} className="block text-sm">
            {actionLabels[action]}
            <select
              className="mt-1"
              name={`approval.${action}`}
              defaultValue={initial.approvalPolicy.tools[action]}
              disabled={readOnly}
            >
              <option value="auto">Allow</option>
              <option value="require_approval">Require approval</option>
              <option value="deny">Deny</option>
            </select>
          </label>
        ))}
        <p className="text-sm text-muted">Gmail send stays approval-gated even if this policy says allow.</p>
      </section>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {readOnly ? null : (
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-pine px-5 py-2.5 text-white disabled:opacity-60"
          >
            {mode === "create" ? "Create agent" : "Save changes"}
          </button>
          {mode === "edit" ? (
            <button
              type="button"
              onClick={() => void archive()}
              className="text-sm text-danger"
            >
              Archive agent
            </button>
          ) : null}
        </div>
      )}
    </form>
  );
}

function domains(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}
