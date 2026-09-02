-- Persist the RAG documents a practice set was grounded on, so a weak area
-- derived from a practice attempt can name which documents produced it.
-- TEXT[] rather than UUID[]: RAG owns these ids, and a malformed one must
-- degrade to an unusable value rather than fail the insert.
ALTER TABLE "practice_db"."practice_sets"
  ADD COLUMN "document_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Stable hash of the concept-priority plan a set was generated for. Empty
-- string means untargeted, which is what every pre-existing row is.
ALTER TABLE "practice_db"."practice_sets"
  ADD COLUMN "targeting_fingerprint" VARCHAR(80) NOT NULL DEFAULT '';

-- Targeted sets must not collide with generic ones for the same chapter.
CREATE INDEX "practice_sets_targeted_cache_idx"
  ON "practice_db"."practice_sets"("student_id", "chapter_key", "content_fingerprint", "targeting_fingerprint");
