-- CreateEnum
CREATE TYPE "discover_db"."AcademicCardStatus" AS ENUM ('queued', 'processing', 'done', 'failed');

-- CreateTable
CREATE TABLE "discover_db"."academic_cards" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "status" "discover_db"."AcademicCardStatus" NOT NULL DEFAULT 'queued',
    "chapter_key" VARCHAR(80) NOT NULL,
    "content_fingerprint" VARCHAR(80) NOT NULL,
    "spec" JSONB,
    "provenance" JSONB,
    "target_weak_area" VARCHAR(160) NOT NULL,
    "document_ids" TEXT[],
    "source_service" VARCHAR(16) NOT NULL,
    "failure_reason" TEXT,
    "model" VARCHAR(80),
    "provider" VARCHAR(24),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academic_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discover_db"."academic_card_attempts" (
    "id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "selected_answer" TEXT NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "answered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academic_card_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "academic_cards_student_id_created_at_idx" ON "discover_db"."academic_cards"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "academic_cards_cache_idx" ON "discover_db"."academic_cards"("student_id", "chapter_key", "content_fingerprint");

-- CreateIndex
CREATE INDEX "academic_card_attempts_student_id_created_at_idx" ON "discover_db"."academic_card_attempts"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "academic_card_attempts_card_id_student_id_idx" ON "discover_db"."academic_card_attempts"("card_id", "student_id");

-- AddForeignKey
ALTER TABLE "discover_db"."academic_card_attempts" ADD CONSTRAINT "academic_card_attempts_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "discover_db"."academic_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
