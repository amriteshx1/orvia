-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('queued', 'running', 'waitingApproval', 'succeeded', 'failed', 'cancelled', 'budgetExceeded');

-- CreateEnum
CREATE TYPE "BudgetHoldStatus" AS ENUM ('none', 'open', 'unresolved');

-- CreateEnum
CREATE TYPE "ExternalEffectStatus" AS ENUM ('reserved', 'succeeded', 'failed', 'uncertain');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired');

-- CreateTable
CREATE TABLE "user_budget" (
    "userId" TEXT NOT NULL,
    "monthlyTokenCap" INTEGER NOT NULL,
    "concurrentRunCap" INTEGER NOT NULL,
    "consumedTokens" INTEGER NOT NULL DEFAULT 0,
    "reservedTokens" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_budget_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "execution" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" UUID NOT NULL,
    "agentVersionId" UUID NOT NULL,
    "task" TEXT NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'queued',
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "fencingToken" INTEGER NOT NULL DEFAULT 0,
    "heartbeatAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "openHoldTokens" INTEGER NOT NULL DEFAULT 0,
    "unresolvedHoldTokens" INTEGER NOT NULL DEFAULT 0,
    "budgetReservedTokens" INTEGER NOT NULL DEFAULT 0,
    "budgetHoldStatus" "BudgetHoldStatus" NOT NULL DEFAULT 'none',
    "finalText" TEXT,
    "errorCode" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "reasoningTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DOUBLE PRECISION,
    "langfuseTraceId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "execution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_checkpoint" (
    "id" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "messages" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_checkpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_step" (
    "id" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "toolName" TEXT,
    "input" JSONB,
    "output" JSONB,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cachedTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_effect" (
    "id" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "toolCallId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "status" "ExternalEffectStatus" NOT NULL,
    "requestHash" TEXT NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_effect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "executionId" UUID NOT NULL,
    "toolCallId" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "proposedInput" JSONB NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "comment" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_record" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "executionId" UUID NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cachedTokens" INTEGER NOT NULL,
    "reasoningTokens" INTEGER NOT NULL,
    "toolCallCount" INTEGER NOT NULL,
    "estimatedCostUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "execution_userId_createdAt_idx" ON "execution"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "execution_userId_status_idx" ON "execution"("userId", "status");

-- CreateIndex
CREATE INDEX "execution_status_leaseExpiresAt_idx" ON "execution"("status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "execution_checkpoint_executionId_stepIndex_key" ON "execution_checkpoint"("executionId", "stepIndex");

-- CreateIndex
CREATE INDEX "execution_step_executionId_stepIndex_idx" ON "execution_step"("executionId", "stepIndex");

-- CreateIndex
CREATE UNIQUE INDEX "external_effect_toolCallId_key" ON "external_effect"("toolCallId");

-- CreateIndex
CREATE INDEX "external_effect_executionId_status_idx" ON "external_effect"("executionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "approval_executionId_approvalId_key" ON "approval"("executionId", "approvalId");

-- CreateIndex
CREATE INDEX "approval_userId_status_idx" ON "approval"("userId", "status");

-- CreateIndex
CREATE INDEX "approval_status_expiresAt_idx" ON "approval"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "usage_record_executionId_key" ON "usage_record"("executionId");

-- CreateIndex
CREATE INDEX "usage_record_userId_createdAt_idx" ON "usage_record"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "user_budget" ADD CONSTRAINT "user_budget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution" ADD CONSTRAINT "execution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution" ADD CONSTRAINT "execution_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution" ADD CONSTRAINT "execution_agentVersionId_fkey" FOREIGN KEY ("agentVersionId") REFERENCES "agent_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_checkpoint" ADD CONSTRAINT "execution_checkpoint_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_step" ADD CONSTRAINT "execution_step_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_effect" ADD CONSTRAINT "external_effect_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval" ADD CONSTRAINT "approval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval" ADD CONSTRAINT "approval_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_record" ADD CONSTRAINT "usage_record_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
