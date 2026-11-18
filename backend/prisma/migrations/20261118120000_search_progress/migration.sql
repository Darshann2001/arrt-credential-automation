-- CreateTable
CREATE TABLE "collection_search_progress" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "recordsInserted" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_search_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "collection_search_progress_job_query_key" ON "collection_search_progress"("jobId", "firstName", "lastName");

-- CreateIndex
CREATE INDEX "collection_search_progress_jobId_status_idx" ON "collection_search_progress"("jobId", "status");

-- AddForeignKey
ALTER TABLE "collection_search_progress" ADD CONSTRAINT "collection_search_progress_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "collection_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
