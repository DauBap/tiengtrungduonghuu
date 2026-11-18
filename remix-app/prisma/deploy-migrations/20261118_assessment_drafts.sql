CREATE TABLE IF NOT EXISTS "AssessmentDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssessmentDraft_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssessmentDraft_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "AssessmentDraft_userId_scope_key"
    ON "AssessmentDraft"("userId", "scope");

CREATE INDEX IF NOT EXISTS "AssessmentDraft_userId_updatedAt_idx"
    ON "AssessmentDraft"("userId", "updatedAt");
