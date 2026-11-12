# Orvia

Orvia is a self-hosted workspace for agents you define and supervise. This repository covers accounts, immutable agent versions, durable runs, the execution timeline, and human approvals.

## Requirements

- Node.js 22 or newer
- pnpm 10.20.0 (`corepack enable` then `corepack prepare pnpm@10.20.0 --activate`)
- Docker with Compose

## Local setup

1. Copy the example environment and set a secret of at least 32 characters:

```bash
cp .env.example .env
```

`BETTER_AUTH_SECRET` has to be filled in before the web app will boot. Leave `SMTP_HOST` empty in development; verification and password-reset messages print in the web process log. A real SMTP host is required in production when email verification stays enabled.

Set `OPENAI_API_KEY` before running an agent. The worker calls `gpt-6-luna` through the Responses API with reasoning effort `none`. Temperature is stored on the agent version and is not sent, because this model does not accept it. Leave the Langfuse variables empty unless an operator console is configured; a missing Langfuse client does not stop a run.

2. Start Postgres (with pgvector) and Redis:

```bash
docker compose up -d
```

Postgres is published on `127.0.0.1:5434` so it can sit beside another Postgres already using port 5432. Redis is published on `127.0.0.1:6379`.

3. Install dependencies, generate the Prisma client, and apply the migration:

```bash
pnpm install
pnpm db:migrate
```

4. Run the web app and the worker:

```bash
pnpm dev
```

- Web: http://localhost:3000
- Health: http://localhost:3000/api/health

The health response is OK only when Postgres, the `vector` extension, and Redis are all up. The worker logs the same checks and the BullMQ prefix `orvia-dev`, then consumes execution jobs. A run continues after the browser closes. The execution page updates from a server-sent event stream and falls back to polling every two seconds.

Enable the fixture tool on an agent and set its approval mode to require approval. A task that asks for the fixture action pauses with no lease holder until you approve or reject it. Rejection returns the denial to the model. Approval continues the same execution under a new lease. Pending approvals expire after `APPROVAL_TIMEOUT_HOURS` (24 by default) and fail the run without performing the action.

`pnpm typecheck` and `pnpm lint` check the workspace.

## Workspace

| Path | Role |
| --- | --- |
| `apps/web` | Next.js app: accounts, agents, executions, and approvals |
| `apps/worker` | BullMQ worker that runs ToolLoopAgent |
| `packages/config` | Environment parsing |
| `packages/db` | Prisma schema, migrations, client |
| `packages/core` | Agents, budgets, leases, runner, tools, and approvals |

## Optional integrations

The app and worker start when these are empty. A tool or page that needs a missing credential returns a configuration error instead of failing the process.

| Variable | Used for |
| --- | --- |
| `OPENAI_API_KEY` | Model calls, web search, embeddings, and rubric grading |
| `OPENAI_EMBEDDING_MODEL` | Memory embeddings. Default `text-embedding-3-small` |
| `CREDENTIALS_ENCRYPTION_KEY` | Encrypts connection secrets. 64 hex characters. Required before a secret can be saved |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth App, scopes `read:user` and `repo` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Gmail OAuth. Enable the Gmail API. Read and send are separate consent screens |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_BASE_URL` | Optional traces. Leave empty to disable. `LANGFUSE_BASE_URL` points at Cloud or the local console |

OAuth redirect URLs, using the value of `APP_URL`:

- GitHub: `APP_URL/api/connections/github/callback`
- Google: `APP_URL/api/connections/google/callback`

For local development those are `http://localhost:3000/api/connections/github/callback` and `http://localhost:3000/api/connections/google/callback`.

Web search uses the OpenAI Responses API. The default call cap is `DEFAULT_MAX_WEB_SEARCH_CALLS`. Public HTTP requests can be limited with an agent allowlist. Credentialed HTTP, GitHub writes, and Gmail send go through the external-effect ledger. Gmail send still requires approval when the agent policy allows it. A lost response stays uncertain until you reconcile it on the execution page; it is not sent again.

`deploy/langfuse` is a separate console with its own Postgres, ClickHouse, Redis, and blob store. It is bound to `127.0.0.1:3100` and is not started by `pnpm dev`. The published Langfuse sizing is 4 cores and 16 GiB. On a smaller machine, point the Langfuse variables at Langfuse Cloud instead.

`evals/promptfooconfig.yaml` grades canned good and bad outputs for tool choice and protected writes. It is a product fixture, not a CI check. The bad config is expected to fail:

```bash
pnpm --filter @orvia/core exec promptfoo eval -c ../../evals/promptfooconfig.yaml
pnpm --filter @orvia/core exec promptfoo eval -c ../../evals/promptfooconfig.bad.yaml
```
