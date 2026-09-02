-- CreateEnum
CREATE TYPE "discover_db"."AcademicCardKind" AS ENUM ('mcq_card', 'micro_article');

-- AlterTable
-- kind defaults to 'mcq_card' for existing rows: every card generated before
-- this migration was implicitly an MCQ card.
ALTER TABLE "discover_db"."academic_cards"
  ADD COLUMN "kind" "discover_db"."AcademicCardKind" NOT NULL DEFAULT 'mcq_card',
  ADD COLUMN "viewed_at" TIMESTAMP(3),
  ADD COLUMN "delivered_at" TIMESTAMP(3);

-- DropIndex
DROP INDEX "discover_db"."academic_cards_cache_idx";

-- CreateIndex
-- kind joins the cache-lookup key: an MCQ card and a micro-article generated
-- for the same chapter+weak-area must not collide in the dedupe lookup.
CREATE INDEX "academic_cards_cache_idx" ON "discover_db"."academic_cards"("student_id", "chapter_key", "content_fingerprint", "kind");
