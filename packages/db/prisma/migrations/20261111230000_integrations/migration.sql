-- AlterTable
ALTER TABLE "execution" ADD COLUMN "embeddingTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "execution" ADD COLUMN "webSearchCalls" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "usage_record" ADD COLUMN "embeddingTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "usage_record" ADD COLUMN "webSearchCalls" INTEGER NOT NULL DEFAULT 0;

-- CreateEnum
CREATE TYPE "ConnectionProvider" AS ENUM ('http', 'github', 'gmail', 'slack');
CREATE TYPE "ConnectionStatus" AS ENUM ('active', 'revoked', 'error');
CREATE TYPE "MemoryStatus" AS ENUM ('proposed', 'accepted', 'rejected');
CREATE TYPE "MemoryAuthor" AS ENUM ('agent', 'user');
CREATE TYPE "EvaluationRunStatus" AS ENUM ('running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "connection" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "ConnectionProvider" NOT NULL,
    "label" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'active',
    "scopes" TEXT[],
    "externalAccountId" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "connection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "secret" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "secret_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauth_state" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "ConnectionProvider" NOT NULL,
    "state" TEXT NOT NULL,
    "codeVerifier" TEXT,
    "scopes" TEXT[],
    "label" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oauth_state_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "memory_item" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'fact',
    "embedding" vector(1536),
    "status" "MemoryStatus" NOT NULL DEFAULT 'proposed',
    "sourceExecutionId" UUID,
    "sourceStepId" UUID,
    "toolCallId" TEXT,
    "createdBy" "MemoryAuthor" NOT NULL,
    "embeddingHoldTokens" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "memory_item_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "evaluation_dataset" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "evaluation_dataset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "evaluation_case" (
    "id" UUID NOT NULL,
    "datasetId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "assertions" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evaluation_case_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "evaluation_run" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "datasetId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "agentVersionId" UUID NOT NULL,
    "status" "EvaluationRunStatus" NOT NULL DEFAULT 'running',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "evaluation_run_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "evaluation_case_result" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "executionId" UUID,
    "passed" BOOLEAN,
    "score" DOUBLE PRECISION,
    "tools" JSONB,
    "costUsd" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "evaluation_case_result_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connection_userId_provider_idx" ON "connection"("userId", "provider");
CREATE UNIQUE INDEX "secret_connectionId_key" ON "secret"("connectionId");
CREATE UNIQUE INDEX "oauth_state_state_key" ON "oauth_state"("state");
CREATE INDEX "oauth_state_userId_state_idx" ON "oauth_state"("userId", "state");
CREATE UNIQUE INDEX "memory_item_toolCallId_key" ON "memory_item"("toolCallId");
CREATE INDEX "memory_item_userId_agentId_status_idx" ON "memory_item"("userId", "agentId", "status");
CREATE INDEX "memory_item_embedding_hnsw" ON "memory_item" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "evaluation_dataset_userId_createdAt_idx" ON "evaluation_dataset"("userId", "createdAt");
CREATE INDEX "evaluation_case_datasetId_position_idx" ON "evaluation_case"("datasetId", "position");
CREATE INDEX "evaluation_run_userId_createdAt_idx" ON "evaluation_run"("userId", "createdAt");
CREATE UNIQUE INDEX "evaluation_case_result_executionId_key" ON "evaluation_case_result"("executionId");
CREATE UNIQUE INDEX "evaluation_case_result_runId_caseId_key" ON "evaluation_case_result"("runId", "caseId");

-- AddForeignKey
ALTER TABLE "connection" ADD CONSTRAINT "connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "secret" ADD CONSTRAINT "secret_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "secret" ADD CONSTRAINT "secret_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory_item" ADD CONSTRAINT "memory_item_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory_item" ADD CONSTRAINT "memory_item_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_dataset" ADD CONSTRAINT "evaluation_dataset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_case" ADD CONSTRAINT "evaluation_case_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "evaluation_dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_run" ADD CONSTRAINT "evaluation_run_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_run" ADD CONSTRAINT "evaluation_run_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "evaluation_dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_run" ADD CONSTRAINT "evaluation_run_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_run" ADD CONSTRAINT "evaluation_run_agentVersionId_fkey" FOREIGN KEY ("agentVersionId") REFERENCES "agent_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evaluation_case_result" ADD CONSTRAINT "evaluation_case_result_runId_fkey" FOREIGN KEY ("runId") REFERENCES "evaluation_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_case_result" ADD CONSTRAINT "evaluation_case_result_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "evaluation_case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_case_result" ADD CONSTRAINT "evaluation_case_result_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "execution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
