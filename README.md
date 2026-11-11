# Orvia

Orvia is a self-hosted workspace for agents you define and supervise. This repository currently covers the foundation, accounts, and immutable agent versions. Agents do not run yet.

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

The health response is OK only when Postgres, the `vector` extension, and Redis are all up. The worker logs the same checks and the BullMQ prefix `orvia-dev`. It does not run agent jobs.

`pnpm typecheck` and `pnpm lint` check the workspace.

## Workspace

| Path | Role |
| --- | --- |
| `apps/web` | Next.js app: accounts, workspace shell, agent editor |
| `apps/worker` | Health check and queue connection |
| `packages/config` | Environment parsing |
| `packages/db` | Prisma schema, migration, client |
| `packages/core` | Agent rules that do not depend on Next.js |
