# Roognis Local App Runbook

This is the step-by-step runbook for launching the full Roognis app locally on Windows with Docker Desktop.

Use PowerShell from the repo root:

```powershell
cd C:\Users\Admin\Desktop\Roognous
```

## 1. Prerequisites

Install these first:

- Git
- Docker Desktop with WSL 2 backend
- Windows PowerShell
- A populated `.env` file in the repo root

Check Docker:

```powershell
docker --version
docker compose version
docker desktop status
docker version
```

If `docker version` cannot print a server version, Docker Desktop is not ready yet.

Start Docker Desktop:

```powershell
Start-Process -FilePath "C:\Program Files\Docker\Docker\Docker Desktop.exe"
```

Wait until this works:

```powershell
docker version --format "{{.Server.Version}}"
```

## 2. Configure `.env`

Create `.env` from the example if it does not exist:

```powershell
Copy-Item .env.example .env
```

Open `.env` and fill at least:

```env
DB_PASSWORD=change-me
JWT_SECRET=change-me-long-secret
INTERNAL_SERVICE_TOKEN=change-me-internal-token
DEMO_SCHOOL_ID=550e8400-e29b-41d4-a716-446655440000

LLM_PROVIDER=gemini
IMAGE_PROVIDER=gemini
GEMINI_API_KEY=

OPENROUTER_API_KEY=
OPENROUTER_QUIZ_MODEL=openai/gpt-5-mini
OPENROUTER_QUIZ_REASONING_EFFORT=low
OPENROUTER_QUIZ_MAX_COMPLETION_TOKENS=3800
QUIZ_QUESTION_COUNT=10
```

Notes:

- Do not commit `.env`.
- `OPENROUTER_API_KEY` must have credits for quiz generation.
- If OpenRouter returns `402`, lower `OPENROUTER_QUIZ_MAX_COMPLETION_TOKENS` or add credits.
- The default local RAG path uses deterministic demo embeddings with `RAG_TEST_MODE=true`, so Ollama/Chroma are not required for the normal demo.

## 3. Pull Latest `main`

```powershell
git checkout main
git fetch --prune origin
git pull --ff-only origin main
git status -sb
```

Expected:

```text
## main...origin/main
```

## 4. Validate Compose

```powershell
docker compose config --quiet
docker compose config --services
```

Expected services:

```text
postgres
rag
ai
analytics
quiz
auth
textbook-seed
traefik
frontend
```

## 5. Launch The Full App

From the repo root:

```powershell
docker compose up --build -d
```

This starts:

- PostgreSQL
- Auth Service
- AI Service
- RAG Service
- Analytics Service
- Quiz Service
- Frontend
- Traefik gateway
- One-shot `textbook-seed` job

The first run after a Docker reinstall can take several minutes because Docker must download base images and reinstall dependencies.

## 6. Watch Startup

Check containers:

```powershell
docker compose ps
```

Watch all logs:

```powershell
docker compose logs -f
```

Watch the textbook seed job:

```powershell
docker compose logs -f textbook-seed
```

Successful seed looks like:

```text
[textbook-seed] Complete: 27 uploaded, 0 already ready, 0 failed.
```

The seeder is idempotent. Restarting the stack should not duplicate ready chapters.

## 7. Open The App

Use:

- Frontend: `http://localhost:3000`
- API gateway: `http://localhost`
- Traefik dashboard: `http://localhost:8080`
- Quiz health: `http://localhost:3005/api/quiz/health`

Demo users:

```text
Teacher: teacher@demo.com / demo1234
Student: arjun@demo.com / demo1234
Parent:  parent1@demo.com / demo1234
```

## 8. Health Checks

Run:

```powershell
curl.exe -s -o NUL -w "frontend=%{http_code}`n" http://localhost:3000/
curl.exe -s -o NUL -w "gateway=%{http_code}`n" http://localhost/
curl.exe -s -o NUL -w "quiz=%{http_code}`n" http://localhost/api/quiz/health
curl.exe -s -o NUL -w "auth_me_unauth=%{http_code}`n" http://localhost/api/auth/me
docker compose ps
```

Expected:

```text
frontend=200
gateway=200
quiz=200
auth_me_unauth=401
```

`401` for `/api/auth/me` is correct when not logged in. It means the auth route is reachable.

RAG health is checked through Docker health status:

```powershell
docker compose ps rag
```

Expected:

```text
Up ... (healthy)
```

## 9. Teacher Quiz Flow

Login and check quiz chapter status:

```powershell
$teacherCookie = Join-Path $env:TEMP "roognis-teacher-cookies.txt"
Remove-Item -LiteralPath $teacherCookie -ErrorAction SilentlyContinue

$loginBody = @{ email = "teacher@demo.com"; password = "demo1234" } | ConvertTo-Json -Compress
$loginBody | curl.exe -s -c $teacherCookie -X POST http://localhost/api/auth/login -H "Content-Type: application/json" --data-binary "@-"

curl.exe -s -b $teacherCookie http://localhost/api/quiz/chapters
```

Generate missing quizzes for ready chapters:

```powershell
curl.exe -s -b $teacherCookie -X POST http://localhost/api/quiz/backfill -H "Content-Type: application/json" -d "{}"
```

If generation fails with `402`, the app is running but OpenRouter has insufficient credits. Add credits or use a funded key, then recreate AI and Quiz:

```powershell
docker compose up -d --force-recreate ai quiz
```

Then retry backfill.

## 10. Student Quiz Flow

```powershell
$studentCookie = Join-Path $env:TEMP "roognis-student-cookies.txt"
Remove-Item -LiteralPath $studentCookie -ErrorAction SilentlyContinue

$loginBody = @{ email = "arjun@demo.com"; password = "demo1234" } | ConvertTo-Json -Compress
$loginBody | curl.exe -s -c $studentCookie -X POST http://localhost/api/auth/login -H "Content-Type: application/json" --data-binary "@-"

curl.exe -s -b $studentCookie http://localhost/api/quiz/student/chapters
```

In the UI:

1. Open `http://localhost:3000`.
2. Login as `arjun@demo.com`.
3. Go to `Quizzes`.
4. Open a ready quiz.
5. Submit answers and review the result.

## 11. Stop The App

Stop containers but keep data:

```powershell
docker compose down
```

Stop and remove volumes/data:

```powershell
docker compose down -v
```

Use `down -v` only when you are okay wiping the local PostgreSQL database, uploaded PDFs, seeded documents, generated quizzes, and other Docker volume state.

## 12. Restart The App

Normal restart:

```powershell
docker compose up -d
```

Rebuild after pulling code:

```powershell
git checkout main
git pull --ff-only origin main
docker compose up --build -d
```

Recreate only changed services:

```powershell
docker compose up -d --force-recreate ai quiz
docker compose up -d --force-recreate frontend
```

## 13. Useful Logs

```powershell
docker compose logs -f auth
docker compose logs -f ai
docker compose logs -f rag
docker compose logs -f quiz
docker compose logs -f frontend
docker compose logs -f textbook-seed
```

Tail recent logs:

```powershell
docker compose logs --since=10m --tail=120 ai quiz rag auth frontend
```

## 14. Run Tests Locally

Node services:

```powershell
npm test --prefix services/ai
npm test --prefix services/quiz
npm test --prefix services/analytics
```

RAG tests:

```powershell
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD = "1"
python -m pytest services/rag/tests
```

Frontend inline script parse check:

```powershell
@'
const fs = require('fs');
const html = fs.readFileSync('frontend/index.html', 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
for (const [index, script] of scripts.entries()) {
  new Function(script);
  console.log(`script_${index + 1}=ok`);
}
'@ | node -
```

## 15. Docker Desktop Recovery

Use this if Docker commands hang, return `Docker Desktop is unable to start`, or BuildKit reports storage I/O errors.

### Soft restart

```powershell
docker desktop restart
```

If that hangs, use:

```powershell
Get-Process | Where-Object { $_.ProcessName -match "Docker|com\.docker|^docker$|^docker-" } | Stop-Process -Force -ErrorAction SilentlyContinue
wsl.exe --shutdown
Start-Sleep -Seconds 5
Start-Process -FilePath "C:\Program Files\Docker\Docker\Docker Desktop.exe"
```

Wait:

```powershell
docker version --format "{{.Server.Version}}"
docker desktop status
```

### Clean Docker reinstall

Use only if Docker Desktop is repeatedly crashing.

Stop Docker:

```powershell
Get-Process | Where-Object { $_.ProcessName -match "Docker|com\.docker|^docker$|^docker-" } | Stop-Process -Force -ErrorAction SilentlyContinue
wsl.exe --shutdown
```

Uninstall Docker Desktop with admin/UAC prompt:

```powershell
Start-Process -FilePath "C:\Program Files\Docker\Docker\Docker Desktop Installer.exe" -ArgumentList @("uninstall","--quiet") -Verb RunAs -Wait
```

Reinstall from a downloaded installer:

```powershell
Start-Process -FilePath "C:\Users\Admin\Downloads\Docker Desktop Installer.exe" -ArgumentList @("install","--quiet","--accept-license","--backend=wsl-2") -Verb RunAs -Wait
```

Start Docker:

```powershell
Start-Process -FilePath "C:\Program Files\Docker\Docker\Docker Desktop.exe"
```

Then rebuild:

```powershell
cd C:\Users\Admin\Desktop\Roognous
docker compose up --build -d
```

Important: a full Docker reinstall can remove local images, containers, and volumes. If volumes are removed, the database and uploaded/generated local demo state will be rebuilt from seed data.

## 16. Common Problems

### OpenRouter `402 Insufficient credits`

The app is running, but quiz generation cannot continue.

Fix:

1. Add credits to the OpenRouter account for the key in `.env`.
2. Optionally lower:

```env
OPENROUTER_QUIZ_MAX_COMPLETION_TOKENS=3000
```

3. Recreate AI and Quiz:

```powershell
docker compose up -d --force-recreate ai quiz
```

4. Retry backfill from teacher UI or curl.

### Port already in use

Check:

```powershell
netstat -ano | findstr ":80 "
netstat -ano | findstr ":3000 "
netstat -ano | findstr ":3005 "
```

Stop the conflicting process or change ports in `docker-compose.yml`.

### Fresh Docker has no data

If Docker was reinstalled or volumes were removed, run:

```powershell
docker compose up --build -d
docker compose logs -f textbook-seed
```

Wait for:

```text
[textbook-seed] Complete
```

### RAG `/api/rag/health` returns 404

That is expected. RAG health is exposed inside the container at `/health` and checked by Docker. Use:

```powershell
docker compose ps rag
```

## 17. Quick Full Relaunch Checklist

```powershell
cd C:\Users\Admin\Desktop\Roognous
git checkout main
git fetch --prune origin
git pull --ff-only origin main
docker compose config --quiet
docker compose up --build -d
docker compose ps
docker compose logs -f textbook-seed
```

Open:

```text
http://localhost:3000
```

