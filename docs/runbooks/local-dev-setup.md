# Local Dev Setup Runbook

Step-by-step guide to run the full Nexoraa Dify stack on your local machine. No AWS access required.

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- [Git](https://git-scm.com/) installed
- 8 GB RAM available for Docker (recommended)
- 10 GB free disk space (for Docker images)

---

## One-Time Setup

### Step 1 — Clone the repo

```bash
git clone https://github.com/Nexoraa-Studio/dify.git
cd dify
```

### Step 2 — Create your local env file

```bash
cp deploy/.env.example deploy/.env.local
```

Open `deploy/.env.local` in any text editor and update these 3 values:

```
SECRET_KEY=          ← replace with output of: openssl rand -base64 42
CONSOLE_WEB_URL=http://localhost
APP_WEB_URL=http://localhost
```

Also clear the ECR line (not needed locally):
```
ECR_REGISTRY=
```

To generate a secret key, run this in your terminal:
```bash
openssl rand -base64 42
```

### Step 3 — Create the .env symlink (required by Docker Compose)

```bash
ln -sf "$(pwd)/deploy/.env.local" deploy/.env
```

---

## Starting the Stack

### Step 4 — Build images from source

> ⏱ First time only: takes 10–15 minutes. Subsequent runs use Docker cache (~30 sec).

```bash
docker compose \
  -f deploy/docker-compose.yml \
  -f deploy/docker-compose.local.yml \
  --env-file deploy/.env.local \
  build api web
```

You should see Docker building the Python (api) and Next.js (web) images. Wait for it to finish.

### Step 5 — Start all services

```bash
docker compose \
  -f deploy/docker-compose.yml \
  -f deploy/docker-compose.local.yml \
  --env-file deploy/.env.local \
  up -d
```

Expected output — all 8 containers created and started:
```
Container deploy-db-1           Started
Container deploy-redis-1        Started
Container deploy-sandbox-1      Started
Container deploy-web-1          Started
Container deploy-api-1          Started
Container deploy-worker-1       Started
Container deploy-plugin_daemon-1 Started
Container deploy-nginx-1        Started
```

### Step 6 — Run database migrations

> Required on first run (creates all DB tables). Safe to skip on subsequent runs.

```bash
docker compose \
  -f deploy/docker-compose.yml \
  -f deploy/docker-compose.local.yml \
  --env-file deploy/.env.local \
  exec -T api flask db upgrade
```

Wait for it to finish. Last line should look like:
```
INFO  [alembic.runtime.migration] Running upgrade xxxx -> yyyy, ...
```

### Step 7 — Verify everything is running

```bash
docker compose \
  -f deploy/docker-compose.yml \
  -f deploy/docker-compose.local.yml \
  --env-file deploy/.env.local \
  ps
```

All 8 services should show `Up`:
```
NAME                     IMAGE                        STATUS
deploy-api-1             nexoraa/dify-api:local       Up
deploy-worker-1          nexoraa/dify-api:local       Up
deploy-web-1             nexoraa/dify-web:local       Up
deploy-db-1              pgvector/pgvector:pg15       Up
deploy-redis-1           redis:6-alpine               Up
deploy-sandbox-1         langgenius/dify-sandbox      Up
deploy-plugin_daemon-1   langgenius/dify-plugin-daemon Up
deploy-nginx-1           nginx:latest                 Up
```

### Step 8 — Open in browser

Go to: **http://localhost/install**

Create your admin account on the first visit. After that, log in at **http://localhost/apps**.

---

## Stopping the Stack

```bash
docker compose \
  -f deploy/docker-compose.yml \
  -f deploy/docker-compose.local.yml \
  --env-file deploy/.env.local \
  down
```

Your data (Postgres, Redis, app files) is preserved in `deploy/volumes/` and will be there next time you start.

---

## Day-to-Day Usage (After First Setup)

On subsequent days you only need Steps 5 and 7 — images are already built and migrations already run.

```bash
# Start
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml --env-file deploy/.env.local up -d

# Stop
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml --env-file deploy/.env.local down
```

---

## Pulling Latest Code Changes

When a teammate pushes changes to `api/` or `web/`, rebuild the affected image:

```bash
git pull origin main

# Rebuild only what changed (e.g. api changed):
docker compose \
  -f deploy/docker-compose.yml \
  -f deploy/docker-compose.local.yml \
  --env-file deploy/.env.local \
  build api

# Restart the stack
docker compose \
  -f deploy/docker-compose.yml \
  -f deploy/docker-compose.local.yml \
  --env-file deploy/.env.local \
  up -d
```

---

## Viewing Logs

```bash
# All services
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml --env-file deploy/.env.local logs -f

# Just the API
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml --env-file deploy/.env.local logs -f api

# Just the web frontend
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml --env-file deploy/.env.local logs -f web
```

---

## Troubleshooting

### "docker: command not found"
Install Docker Desktop from https://www.docker.com/products/docker-desktop/

### "Cannot connect to the Docker daemon"
Docker Desktop is not running. Open Docker Desktop from your Applications folder and wait for it to fully start (icon stops animating).

### Page shows blank / spinning loader
Run the DB migrations (Step 6). This happens when the database tables don't exist yet.

### "port 80 already in use"
Something else is using port 80 on your machine (another web server, nginx, etc.).
```bash
# Find what's using port 80
sudo lsof -i :80
# Kill it, or stop the conflicting service
```

### A container keeps restarting
Check its logs:
```bash
docker logs deploy-api-1 --tail 50
```
Common cause: wrong value in `deploy/.env.local`. Double-check `SECRET_KEY`, `DB_PASSWORD`, `REDIS_PASSWORD`.

### "no space left on device"
Docker is out of disk space. Clean up unused images:
```bash
docker system prune -a
```
Then rebuild from Step 4.

---

## Service URLs (Local)

| Service | URL |
|---------|-----|
| App | http://localhost/apps |
| Install / Login | http://localhost/install |
| API | http://localhost/v1 |
| Console API | http://localhost/console/api |
