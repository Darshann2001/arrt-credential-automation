-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "credential_records" (
    "id" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "credentialString" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "normalizedCity" TEXT NOT NULL,
    "normalizedState" TEXT NOT NULL,
    "normalizedCredential" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ARRT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credential_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_jobs" (
    "id" UUID NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'ARRT',
    "requestedTarget" INTEGER NOT NULL DEFAULT 0,
    "recordsFound" INTEGER NOT NULL DEFAULT 0,
    "recordsInserted" INTEGER NOT NULL DEFAULT 0,
    "recordsSkipped" INTEGER NOT NULL DEFAULT 0,
    "recordsRejected" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_job_logs" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_job_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credential_records_normalizedName_idx" ON "credential_records"("normalizedName");

-- CreateIndex
CREATE INDEX "credential_records_normalizedState_idx" ON "credential_records"("normalizedState");

-- CreateIndex
CREATE INDEX "credential_records_normalizedCity_idx" ON "credential_records"("normalizedCity");

-- CreateIndex
CREATE INDEX "credential_records_normalizedCredential_idx" ON "credential_records"("normalizedCredential");

-- CreateIndex
CREATE INDEX "credential_records_state_city_idx" ON "credential_records"("state", "city");

-- CreateIndex
CREATE INDEX "credential_records_createdAt_idx" ON "credential_records"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "credential_records_identity_key" ON "credential_records"("normalizedName", "normalizedCity", "normalizedState", "normalizedCredential");

-- CreateIndex
CREATE INDEX "collection_jobs_status_idx" ON "collection_jobs"("status");

-- CreateIndex
CREATE INDEX "collection_jobs_createdAt_idx" ON "collection_jobs"("createdAt");

-- CreateIndex
CREATE INDEX "collection_job_logs_jobId_createdAt_idx" ON "collection_job_logs"("jobId", "createdAt");

-- AddForeignKey
ALTER TABLE "collection_job_logs" ADD CONSTRAINT "collection_job_logs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "collection_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
