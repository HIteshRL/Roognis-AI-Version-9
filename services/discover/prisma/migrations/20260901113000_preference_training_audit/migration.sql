ALTER TABLE "discover_db"."preference_refresh_runs"
  ADD COLUMN "training_status" VARCHAR(24) NOT NULL DEFAULT 'not_started',
  ADD COLUMN "training_promoted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "training_reason" VARCHAR(80),
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ;
