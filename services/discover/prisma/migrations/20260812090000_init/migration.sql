-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "discover_db";

-- CreateTable
CREATE TABLE "discover_db"."interest_topics" (
    "key" VARCHAR(90) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "cluster" VARCHAR(40) NOT NULL,
    "terms" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "seeded" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interest_topics_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "discover_db"."interest_nodes" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "key" VARCHAR(90) NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "origin" VARCHAR(20) NOT NULL DEFAULT 'behaviour',
    "last_seen" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interest_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discover_db"."interest_edges" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "from_kind" VARCHAR(16) NOT NULL,
    "from_key" VARCHAR(90) NOT NULL,
    "to_kind" VARCHAR(16) NOT NULL,
    "to_key" VARCHAR(90) NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interest_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discover_db"."interest_candidates" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "key" VARCHAR(90) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "cluster" VARCHAR(40) NOT NULL DEFAULT 'other',
    "evidence_count" INTEGER NOT NULL DEFAULT 1,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "proposed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "interest_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discover_db"."discover_articles" (
    "id" UUID NOT NULL,
    "source_key" VARCHAR(80) NOT NULL,
    "source_name" VARCHAR(120) NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "summary" TEXT NOT NULL,
    "url" VARCHAR(1200) NOT NULL,
    "image_url" VARCHAR(1600),
    "published_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "safety_status" VARCHAR(30) NOT NULL DEFAULT 'approved',
    "origin" VARCHAR(20) NOT NULL DEFAULT 'rss',
    "hunt_topic_key" VARCHAR(90),
    "topics" JSONB,
    "entities" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discover_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discover_db"."news_signals" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "session_id" VARCHAR(64),
    "kind" VARCHAR(20) NOT NULL,
    "dwell_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discover_db"."student_interest_profiles" (
    "student_id" UUID NOT NULL,
    "summary" JSONB NOT NULL,
    "prompt_context" TEXT NOT NULL,
    "signal_count" INTEGER NOT NULL DEFAULT 0,
    "imported_legacy_graph_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_interest_profiles_pkey" PRIMARY KEY ("student_id")
);

-- CreateTable
CREATE TABLE "discover_db"."hunt_runs" (
    "id" UUID NOT NULL,
    "topic_key" VARCHAR(90) NOT NULL,
    "topic_label" VARCHAR(120) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
    "queries" JSONB,
    "provider" VARCHAR(24),
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "stored_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hunt_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interest_topics_status_idx" ON "discover_db"."interest_topics"("status");

-- CreateIndex
CREATE INDEX "interest_nodes_student_id_weight_idx" ON "discover_db"."interest_nodes"("student_id", "weight");

-- CreateIndex
CREATE INDEX "interest_nodes_kind_key_idx" ON "discover_db"."interest_nodes"("kind", "key");

-- CreateIndex
CREATE UNIQUE INDEX "interest_nodes_student_id_kind_key_key" ON "discover_db"."interest_nodes"("student_id", "kind", "key");

-- CreateIndex
CREATE INDEX "interest_edges_student_id_weight_idx" ON "discover_db"."interest_edges"("student_id", "weight");

-- CreateIndex
CREATE UNIQUE INDEX "interest_edges_student_id_from_kind_from_key_to_kind_to_key_key" ON "discover_db"."interest_edges"("student_id", "from_kind", "from_key", "to_kind", "to_key");

-- CreateIndex
CREATE INDEX "interest_candidates_student_id_status_proposed_at_idx" ON "discover_db"."interest_candidates"("student_id", "status", "proposed_at");

-- CreateIndex
CREATE UNIQUE INDEX "interest_candidates_student_id_key_key" ON "discover_db"."interest_candidates"("student_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "discover_articles_url_key" ON "discover_db"."discover_articles"("url");

-- CreateIndex
CREATE INDEX "discover_articles_safety_status_published_at_idx" ON "discover_db"."discover_articles"("safety_status", "published_at");

-- CreateIndex
CREATE INDEX "discover_articles_category_published_at_idx" ON "discover_db"."discover_articles"("category", "published_at");

-- CreateIndex
CREATE INDEX "discover_articles_hunt_topic_key_published_at_idx" ON "discover_db"."discover_articles"("hunt_topic_key", "published_at");

-- CreateIndex
CREATE INDEX "news_signals_student_id_created_at_idx" ON "discover_db"."news_signals"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "news_signals_student_id_article_id_idx" ON "discover_db"."news_signals"("student_id", "article_id");

-- CreateIndex
CREATE INDEX "hunt_runs_status_created_at_idx" ON "discover_db"."hunt_runs"("status", "created_at");

-- CreateIndex
CREATE INDEX "hunt_runs_topic_key_created_at_idx" ON "discover_db"."hunt_runs"("topic_key", "created_at");

-- AddForeignKey
ALTER TABLE "discover_db"."news_signals" ADD CONSTRAINT "news_signals_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "discover_db"."discover_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

