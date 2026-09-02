-- CreateTable
CREATE TABLE "ai_db"."safety_review_flags" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "surface" VARCHAR(24) NOT NULL,
    "session_id" UUID,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_review_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "safety_review_flags_school_id_acknowledged_at_created_at_idx" ON "ai_db"."safety_review_flags"("school_id", "acknowledged_at", "created_at");

-- CreateIndex
CREATE INDEX "safety_review_flags_student_id_created_at_idx" ON "ai_db"."safety_review_flags"("student_id", "created_at");

