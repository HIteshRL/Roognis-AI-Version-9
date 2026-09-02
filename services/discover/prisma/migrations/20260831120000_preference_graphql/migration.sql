CREATE TABLE "discover_db"."student_preferences" (
  "id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "topic_key" VARCHAR(90) NOT NULL,
  "stance" VARCHAR(16) NOT NULL,
  "source" VARCHAR(24) NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "evidence_ref" VARCHAR(240),
  "model_version" VARCHAR(80),
  "muted" BOOLEAN NOT NULL DEFAULT false,
  "last_seen" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "student_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "student_preferences_student_id_topic_key_key"
  ON "discover_db"."student_preferences"("student_id", "topic_key");
CREATE INDEX "student_preferences_student_id_muted_updated_at_idx"
  ON "discover_db"."student_preferences"("student_id", "muted", "updated_at");

CREATE TABLE "discover_db"."preference_observations" (
  "id" UUID NOT NULL,
  "event_id" VARCHAR(96) NOT NULL,
  "student_id" UUID NOT NULL,
  "topic_key" VARCHAR(90) NOT NULL,
  "stance" VARCHAR(16) NOT NULL,
  "source" VARCHAR(24) NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "evidence_ref" VARCHAR(240),
  "model_version" VARCHAR(80),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "preference_observations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "preference_observations_student_id_event_id_topic_key_key"
  ON "discover_db"."preference_observations"("student_id", "event_id", "topic_key");
CREATE INDEX "preference_observations_student_id_created_at_idx"
  ON "discover_db"."preference_observations"("student_id", "created_at");
CREATE INDEX "preference_observations_student_id_topic_key_created_at_idx"
  ON "discover_db"."preference_observations"("student_id", "topic_key", "created_at");

CREATE TABLE "discover_db"."preference_refresh_runs" (
  "id" UUID NOT NULL,
  "run_key" VARCHAR(80) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'running',
  "profile_count" INTEGER NOT NULL DEFAULT 0,
  "model_version" VARCHAR(80),
  "error" TEXT,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ,
  CONSTRAINT "preference_refresh_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "preference_refresh_runs_run_key_key"
  ON "discover_db"."preference_refresh_runs"("run_key");
CREATE INDEX "preference_refresh_runs_status_started_at_idx"
  ON "discover_db"."preference_refresh_runs"("status", "started_at");

CREATE TABLE "discover_db"."preference_decision_records" (
  "id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "topic_key" VARCHAR(90) NOT NULL,
  "affinity" DOUBLE PRECISION NOT NULL,
  "source" VARCHAR(24) NOT NULL,
  "override_applied" BOOLEAN NOT NULL DEFAULT false,
  "rule_version" VARCHAR(80) NOT NULL,
  "model_version" VARCHAR(80),
  "evidence_refs" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "preference_decision_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "preference_decision_records_student_id_topic_key_created_at_idx"
  ON "discover_db"."preference_decision_records"("student_id", "topic_key", "created_at");
