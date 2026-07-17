# Oracle Cloud MVP deployment

This deployment runs the hosted-provider Roognis stack on one ARM64 VM. Do not
enable the `local-ai` profile on the free-tier machine.

## 1. Create the Oracle resources

Create an Ubuntu ARM64 `VM.Standard.A1.Flex` instance in the tenancy home region.
For the current Always Free allowance, use 2 OCPUs, 12 GB memory, and a boot
volume around 100 GB. Assign a reserved public IPv4 address.

Configure the VCN security list and the VM firewall with only:

- TCP 22 from the administrator's public IP.
- TCP 80 from `0.0.0.0/0` for certificate issuance and HTTPS redirection.
- TCP 443 from `0.0.0.0/0` for the application.

Do not expose ports 3000-3005, 5432, 8080, or the Docker daemon. Point the
application domain's DNS `A` record at the reserved public IP before starting
Traefik.

## 2. Install the host dependencies

Install Git, `jq`, Docker Engine, and the Docker Compose plugin using Docker's
official Ubuntu installation instructions. Add the deployment user to the
`docker` group, sign out, and sign back in.

Verify:

```bash
docker version
docker compose version
git --version
jq --version
```

## 3. Prepare the repository and secrets

Clone the merged deployment branch and enter the repository:

```bash
git clone https://github.com/chiru0631/roognis.git
cd roognis
cp .env.production.example .env.production
chmod 600 .env.production
nano .env.production
```

Generate independent hex secrets:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
uuidgen
```

Use the generated values for `DB_PASSWORD`, `JWT_SECRET`,
`INTERNAL_SERVICE_TOKEN`, and `BOOTSTRAP_SCHOOL_ID`. Add the domain, certificate
email, production teacher details, and provider API keys. Never add
`.env.production` to Git or paste its contents into logs or chat.

The first teacher password must be at least 12 characters and cannot be
`demo1234`. Store it in a password manager.

## 4. First deployment

Ensure these are enabled for the first run only:

```dotenv
BOOTSTRAP_ENABLED=true
AUTO_SEED_TEXTBOOKS=true
```

Deploy and watch startup:

```bash
./scripts/production/deploy.sh
docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.production.yml logs -f
```

The auth service applies checked-in Prisma migrations and creates the initial
school and teacher only when there are no users. The one-shot textbook service
then uploads chapters that are not already ready.

Check the textbook result:

```bash
docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.production.yml logs textbook-seed
```

Run the end-to-end deployment check:

```bash
./scripts/production/verify.sh
```

## 5. Remove one-time credentials

After the production teacher can sign in and textbook seeding has completed,
edit `.env.production`:

```dotenv
BOOTSTRAP_ENABLED=false
AUTO_SEED_TEXTBOOKS=false
BOOTSTRAP_TEACHER_PASSWORD=
SEED_TEACHER_PASSWORD=
```

Apply the cleaned environment:

```bash
./scripts/production/deploy.sh
```

The teacher already stored in PostgreSQL remains available. Automatic bootstrap
cannot create or replace users after the database contains a user.

## 6. Create pilot accounts

Public self-registration remains disabled. A production teacher can create a
school-scoped student or parent without putting passwords in shell history:

```bash
./scripts/production/create-user.sh
```

The endpoint prevents teachers from creating other teachers, never accepts a
client-supplied school ID, and does not return password hashes. Users can rotate
their own password through `POST /api/auth/change-password`; successful rotation
clears the current session.

## 7. Backups and restores

Create a backup immediately after seeding:

```bash
./scripts/production/backup.sh
```

Schedule the command daily with cron and copy encrypted backups to a second
location such as OCI Object Storage. Local backups alone do not protect against
VM or boot-volume loss.

Restore only during a maintenance window:

```bash
CONFIRM_RESTORE=roognis ./scripts/production/restore.sh \
  backups/roognis-YYYYMMDDTHHMMSSZ.dump
```

The restore script stops data-writing services, verifies the checksum when
present, restores PostgreSQL, and restarts the stack.

## 8. Routine updates

Review and merge changes before updating the VM. Then:

```bash
git pull --ff-only
./scripts/production/deploy.sh
./scripts/production/verify.sh
```

The deploy script validates Compose, creates a pre-deployment backup when
PostgreSQL is already running, rebuilds images, and performs a rolling container
recreation. Check logs and the provider billing dashboards after every release.

## Important limitations

- The initial Prisma migrations are intended for a new production database.
- RAG currently creates its SQLAlchemy tables idempotently at startup; introduce
  Alembic migrations before making incompatible RAG schema changes.
- OCI budget alerts are notifications, not hard spending caps.
- News safety and topic deduplication are automated heuristics and still require
  periodic human review for a student-facing product.
