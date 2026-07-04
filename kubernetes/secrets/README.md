# Secrets

Never commit real secrets to this folder.

Create secrets manually before applying the kustomization.
Replace `<DB_HOST>`, `<DB_USER>`, `<DB_PASS>` with your actual RDS values.

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
  --from-literal=OLLAMA_URL="http://ollama:11434" \
  --from-literal=ANTHROPIC_API_KEY="" \
  --from-literal=AWS_S3_BUCKET="" \
  --from-literal=AWS_ACCESS_KEY_ID="" \
  --from-literal=AWS_SECRET_ACCESS_KEY=""

# Analytics service
kubectl create secret generic analytics-secrets \
  --namespace roognis \
  --from-literal=DATABASE_URL="postgresql://<DB_USER>:<DB_PASS>@<DB_HOST>/roognis?schema=analytics_db" \
  --from-literal=JWT_SECRET="<same as auth>"

# RAG service
kubectl create secret generic rag-secrets \
  --namespace roognis \
  --from-literal=DATABASE_URL="postgresql://<DB_USER>:<DB_PASS>@<DB_HOST>/roognis" \
  --from-literal=JWT_SECRET="<same as auth>" \
  --from-literal=CHROMA_URL="http://chromadb:8000" \
  --from-literal=PINECONE_API_KEY="" \
  --from-literal=PINECONE_ENV=""

# PostgreSQL (only needed if not using RDS)
kubectl create secret generic postgres-secrets \
  --namespace roognis \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 16)"
```

In production, use Sealed Secrets or AWS Secrets Manager + External Secrets Operator instead of `kubectl create secret`.
