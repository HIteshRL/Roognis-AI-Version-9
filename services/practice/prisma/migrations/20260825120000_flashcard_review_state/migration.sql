-- Per-card spaced-repetition scheduler state, independent of PracticeAttempt
-- (which only tracks whole-set completion via flashcards_reviewed_at).
-- card_id is only unique within one PracticeSet's flashcards JSON, so the
-- identity constraint is the composite (student_id, practice_set_id, card_id).
CREATE TABLE "practice_db"."flashcard_review_states" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "practice_set_id" UUID NOT NULL,
    "card_id" VARCHAR(16) NOT NULL,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "interval_days" INTEGER NOT NULL DEFAULT 0,
    "ease_factor" INTEGER NOT NULL DEFAULT 250,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "due_at" TIMESTAMP(3) NOT NULL,
    "last_reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flashcard_review_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flashcard_review_states_student_id_due_at_idx"
  ON "practice_db"."flashcard_review_states"("student_id", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "flashcard_review_identity"
  ON "practice_db"."flashcard_review_states"("student_id", "practice_set_id", "card_id");

-- AddForeignKey
ALTER TABLE "practice_db"."flashcard_review_states"
  ADD CONSTRAINT "flashcard_review_states_practice_set_id_fkey"
  FOREIGN KEY ("practice_set_id") REFERENCES "practice_db"."practice_sets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
