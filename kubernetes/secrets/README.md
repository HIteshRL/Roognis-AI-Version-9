# Secrets

Never commit real secrets to this folder.

Create secrets manually before applying the kustomization.
Replace the database placeholders with values for the selected deployment (managed database or in-cluster PostgreSQL).

```sh
# Auth service
kubectl create secret generic auth-secrets \
  --namespace roognis \
  --from-literal=DATABASE_URL="postgresql://<DB_USER>:<DB_PASS>@<DB_HOST>/roognis?schema=auth_db" \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=DEMO_SCHOOL_ID="550e8400-e29b-41d4-a716-446655440000"

# AI service
kubectl create secret generic ai-secrets \
  --namespace roognis \
  --from-literal=DATABASE_URL="postgresql://<DB_USER>:<DB_PASS>@<DB_HOST>/roognis?schema=ai_db" \
  --from-literal=JWT_SECRET="<same as auth>" \
  --from-literal=INTERNAL_SERVICE_TOKEN="<same as analytics>" \
  --from-literal=GEMINI_API_KEY="<gemini key>" \
  --from-literal=OPENROUTER_API_KEY="<openrouter key>" \
  --from-literal=AWS_S3_BUCKET="" \
  --from-literal=AWS_ACCESS_KEY_ID="" \
  --from-literal=AWS_SECRET_ACCESS_KEY=""

# Analytics service
kubectl create secret generic analytics-secrets \
  --namespace roognis \
  --from-literal=DATABASE_URL="postgresql://<DB_USER>:<DB_PASS>@<DB_HOST>/roognis?schema=analytics_db" \
  --from-literal=JWT_SECRET="<same as auth>" \
  --from-literal=INTERNAL_SERVICE_TOKEN="<shared internal token>"

# Quiz service
kubectl create secret generic quiz-secrets \
  --namespace roognis \
  --from-literal=DATABASE_URL="postgresql://<DB_USER>:<DB_PASS>@<DB_HOST>/roognis?schema=quiz_db" \
  --from-literal=JWT_SECRET="<same as auth>" \
  --from-literal=INTERNAL_SERVICE_TOKEN="<shared internal token>" \
  --from-literal=OPENROUTER_API_KEY="<openrouter key>"

# Practice service
kubectl create secret generic practice-secrets \
  --namespace roognis \
  --from-literal=DATABASE_URL="postgresql://<DB_USER>:<DB_PASS>@<DB_HOST>/roognis?schema=practice_db" \
  --from-literal=JWT_SECRET="<same as auth>" \
  --from-literal=INTERNAL_SERVICE_TOKEN="<shared internal token>" \
  --from-literal=OPENROUTER_API_KEY="<openrouter key>"

# Discover service
# TAVILY_API_KEY is optional: without it the agentic hunt is disabled and the
# curated RSS genres still populate the feed.
kubectl create secret generic discover-secrets \
  --namespace roognis \
  --from-literal=DATABASE_URL="postgresql://<DB_USER>:<DB_PASS>@<DB_HOST>/roognis?schema=discover_db" \
  --from-literal=JWT_SECRET="<same as auth>" \
  --from-literal=INTERNAL_SERVICE_TOKEN="<shared internal token>" \
  --from-literal=OPENROUTER_API_KEY="<openrouter key>" \
  --from-literal=TAVILY_API_KEY=""

# RAG service
kubectl create secret generic rag-secrets \
  --namespace roognis \
  --from-literal=DATABASE_URL="postgresql://<DB_USER>:<DB_PASS>@<DB_HOST>/roognis" \
  --from-literal=JWT_SECRET="<same as auth>" \
  --from-literal=INTERNAL_SERVICE_TOKEN="<shared internal token>"

# PostgreSQL (only needed if not using RDS)
kubectl create secret generic postgres-secrets \
  --namespace roognis \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 16)"
```

In production, use Sealed Secrets or AWS Secrets Manager + External Secrets Operator instead of `kubectl create secret`.
