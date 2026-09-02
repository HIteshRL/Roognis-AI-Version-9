-- CreateTable
CREATE TABLE "discover_db"."video_hunt_runs" (
    "id" UUID NOT NULL,
    "topic_key" VARCHAR(90) NOT NULL,
    "topic_label" VARCHAR(120) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
    "queries" JSONB,
    "provider" VARCHAR(24),
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "stored_count" INTEGER NOT NULL DEFAULT 0,
    "channels_enriched" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_hunt_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discover_db"."discover_videos" (
    "id" UUID NOT NULL,
    "video_id" VARCHAR(32) NOT NULL,
    "channel_id" VARCHAR(32) NOT NULL,
    "channel_name" VARCHAR(160) NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "summary" TEXT NOT NULL,
    "url" VARCHAR(300) NOT NULL,
    "thumbnail_url" VARCHAR(1600),
    "published_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "safety_status" VARCHAR(30) NOT NULL DEFAULT 'approved',
    "origin" VARCHAR(20) NOT NULL DEFAULT 'hunt',
    "hunt_topic_key" VARCHAR(90),
    "topics" JSONB,
    "entities" JSONB,
    "channel_trust_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "channel_narrowness" DOUBLE PRECISION,
    "niche_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discover_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discover_db"."trusted_channels" (
    "id" UUID NOT NULL,
    "channel_id" VARCHAR(32) NOT NULL,
    "channel_name" VARCHAR(160) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "subscriber_count" INTEGER,
    "video_count" INTEGER,
    "topic_narrowness" DOUBLE PRECISION,
    "dominant_topic_key" VARCHAR(90),
    "last_enriched_at" TIMESTAMP(3),
    "evidence_count" INTEGER NOT NULL DEFAULT 0,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "seed_source" VARCHAR(20),
    "promoted_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trusted_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discover_db"."video_signals" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "video_id" UUID NOT NULL,
    "session_id" VARCHAR(64),
    "kind" VARCHAR(20) NOT NULL,
    "dwell_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "video_hunt_runs_status_created_at_idx" ON "discover_db"."video_hunt_runs"("status", "created_at");

-- CreateIndex
CREATE INDEX "video_hunt_runs_topic_key_created_at_idx" ON "discover_db"."video_hunt_runs"("topic_key", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "discover_videos_video_id_key" ON "discover_db"."discover_videos"("video_id");

-- CreateIndex
CREATE UNIQUE INDEX "discover_videos_url_key" ON "discover_db"."discover_videos"("url");

-- CreateIndex
CREATE INDEX "discover_videos_safety_status_published_at_idx" ON "discover_db"."discover_videos"("safety_status", "published_at");

-- CreateIndex
CREATE INDEX "discover_videos_hunt_topic_key_published_at_idx" ON "discover_db"."discover_videos"("hunt_topic_key", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "trusted_channels_channel_id_key" ON "discover_db"."trusted_channels"("channel_id");

-- CreateIndex
CREATE INDEX "trusted_channels_status_idx" ON "discover_db"."trusted_channels"("status");

-- CreateIndex
CREATE INDEX "video_signals_student_id_created_at_idx" ON "discover_db"."video_signals"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "video_signals_student_id_video_id_idx" ON "discover_db"."video_signals"("student_id", "video_id");

-- AddForeignKey
ALTER TABLE "discover_db"."video_signals" ADD CONSTRAINT "video_signals_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "discover_db"."discover_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
