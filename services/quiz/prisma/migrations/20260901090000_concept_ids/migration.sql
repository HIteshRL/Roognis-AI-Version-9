ALTER TABLE "quiz_db"."quiz_questions"
  ADD COLUMN "concept_id" VARCHAR(160),
  ADD COLUMN "misconception_ids" JSONB NOT NULL DEFAULT '[]';

UPDATE "quiz_db"."quiz_questions"
SET "concept_id" = 'concept:v1:' || COALESCE(
  NULLIF(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER("concept_tag"), '[^a-z0-9]+', '-', 'g')), ''),
  MD5(LOWER("concept_tag"))
);

ALTER TABLE "quiz_db"."quiz_questions"
  ALTER COLUMN "concept_id" SET NOT NULL;

CREATE INDEX "quiz_questions_concept_id_idx"
  ON "quiz_db"."quiz_questions"("concept_id");
