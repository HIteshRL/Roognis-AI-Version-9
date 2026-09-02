-- AlterTable
ALTER TABLE "discover_db"."discover_articles"
  ADD COLUMN "raw_title" VARCHAR(240),
  ADD COLUMN "raw_summary" TEXT,
  ADD COLUMN "tone_rewritten" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "tone_model" VARCHAR(80),
  ADD COLUMN "tone_provider" VARCHAR(24);
