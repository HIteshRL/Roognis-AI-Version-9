-- CreateEnum
CREATE TYPE "ai_db"."VisualArtifactStatus" AS ENUM ('queued', 'processing', 'done', 'failed');

-- CreateTable
CREATE TABLE "ai_db"."visual_artifacts" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "status" "ai_db"."VisualArtifactStatus" NOT NULL DEFAULT 'queued',
    "chapter_key" VARCHAR(80) NOT NULL,
    "content_fingerprint" VARCHAR(80) NOT NULL,
    "concept_slug" VARCHAR(120) NOT NULL,
    "prompt" TEXT NOT NULL,
    "spec" JSONB,
    "provenance" JSONB,
    "failure_reason" TEXT,
    "model" VARCHAR(80),
    "provider" VARCHAR(24),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visual_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visual_artifacts_student_id_created_at_idx" ON "ai_db"."visual_artifacts"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "visual_artifacts_cache_idx" ON "ai_db"."visual_artifacts"("student_id", "kind", "chapter_key", "content_fingerprint", "concept_slug");

-- CreateIndex
CREATE INDEX "visual_artifacts_status_created_at_idx" ON "ai_db"."visual_artifacts"("status", "created_at");
