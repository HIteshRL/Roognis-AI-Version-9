-- AlterTable
ALTER TABLE "ai_db"."student_news_articles" ADD COLUMN     "entities" JSONB,
ADD COLUMN     "topics" JSONB;

-- CreateTable
CREATE TABLE "ai_db"."student_interest_nodes" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "key" VARCHAR(90) NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "last_seen" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_interest_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_db"."student_interest_edges" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "from_kind" VARCHAR(16) NOT NULL,
    "from_key" VARCHAR(90) NOT NULL,
    "to_kind" VARCHAR(16) NOT NULL,
    "to_key" VARCHAR(90) NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_interest_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_db"."student_news_signals" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "dwell_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_news_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_db"."student_interest_profiles" (
    "student_id" UUID NOT NULL,
    "summary" JSONB NOT NULL,
    "prompt_context" TEXT NOT NULL,
    "signal_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_interest_profiles_pkey" PRIMARY KEY ("student_id")
);

-- CreateIndex
CREATE INDEX "student_interest_nodes_student_id_weight_idx" ON "ai_db"."student_interest_nodes"("student_id", "weight");

-- CreateIndex
CREATE UNIQUE INDEX "student_interest_nodes_student_id_kind_key_key" ON "ai_db"."student_interest_nodes"("student_id", "kind", "key");

-- CreateIndex
CREATE INDEX "student_interest_edges_student_id_weight_idx" ON "ai_db"."student_interest_edges"("student_id", "weight");

-- CreateIndex
CREATE UNIQUE INDEX "student_interest_edges_student_id_from_kind_from_key_to_kin_key" ON "ai_db"."student_interest_edges"("student_id", "from_kind", "from_key", "to_kind", "to_key");

-- CreateIndex
CREATE INDEX "student_news_signals_student_id_created_at_idx" ON "ai_db"."student_news_signals"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "student_news_signals_student_id_article_id_idx" ON "ai_db"."student_news_signals"("student_id", "article_id");

