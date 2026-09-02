-- AlterTable
ALTER TABLE "quiz_db"."quizzes" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by" UUID,
ALTER COLUMN "status" SET DEFAULT 'pending_review';

-- Backfill: every existing `ready` quiz was published by the generator with no
-- human ever seeing it — the approval route did not exist until this migration.
-- Leaving them `ready` would mean the gate protects only future quizzes while
-- the entire existing corpus of unreviewed, LLM-authored answer keys stays live
-- to students. They are demoted to `pending_review` so a teacher approves them
-- like any new draft.
--
-- This is deliberately visible, not silent: students lose access to existing
-- chapter quizzes until a teacher approves each one, and any attempt in flight
-- at deploy time will fail its submit. Tell teachers before running this.
--
-- To deploy without the demotion — accepting that already-published quizzes
-- stay live unreviewed — delete the statement below before applying.
UPDATE "quiz_db"."quizzes"
   SET "status" = 'pending_review'
 WHERE "status" = 'ready';

UPDATE "quiz_db"."chapter_quiz_sources"
   SET "quiz_status" = 'pending_review'
 WHERE "quiz_status" = 'ready';

