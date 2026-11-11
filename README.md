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
| `packages/core` | Agents, budgets, leases, runner, and approvals |
