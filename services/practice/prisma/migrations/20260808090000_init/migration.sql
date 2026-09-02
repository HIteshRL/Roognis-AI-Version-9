-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "practice_db";

-- CreateEnum
CREATE TYPE "practice_db"."PracticeSetStatus" AS ENUM ('queued', 'processing', 'done', 'failed');

-- CreateTable
CREATE TABLE "practice_db"."practice_sets" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "status" "practice_db"."PracticeSetStatus" NOT NULL DEFAULT 'queued',
    "chapter_key" VARCHAR(80) NOT NULL,
    "content_fingerprint" VARCHAR(80) NOT NULL,
    "summary" JSONB,
    "flashcards" JSONB,
    "quiz" JSONB,
    "provenance" JSONB,
    "failure_reason" TEXT,
    "model" VARCHAR(80),
    "provider" VARCHAR(24),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_db"."practice_attempts" (
    "id" UUID NOT NULL,
    "practice_set_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB NOT NULL DEFAULT '{}',
    "flashcards_reviewed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practice_sets_student_id_created_at_idx" ON "practice_db"."practice_sets"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "practice_sets_cache_idx" ON "practice_db"."practice_sets"("student_id", "chapter_key", "content_fingerprint");

-- CreateIndex
CREATE INDEX "practice_attempts_student_id_created_at_idx" ON "practice_db"."practice_attempts"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "practice_attempts_practice_set_id_student_id_idx" ON "practice_db"."practice_attempts"("practice_set_id", "student_id");

-- AddForeignKey
ALTER TABLE "practice_db"."practice_attempts" ADD CONSTRAINT "practice_attempts_practice_set_id_fkey" FOREIGN KEY ("practice_set_id") REFERENCES "practice_db"."practice_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
