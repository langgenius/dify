# Nexoraa Dify

Nexoraa's fork of [Dify](https://github.com/langgenius/dify) — the LLM application platform powering Nexoraa's SOP workflow engine.

---

## What's in this repo

| Directory | Contents |
|-----------|----------|
| `api/` | Backend — Python / Flask |
| `web/` | Frontend — Next.js |
| `deploy/` | Docker Compose stack + nginx config for EC2 |
| `.github/workflows/` | CI/CD — build images → ECR → deploy to EC2 |
| `docs/runbooks/` | Step-by-step guides for common tasks |

---

## Running locally

See the full guide: [`docs/runbooks/local-dev-setup.md`](docs/runbooks/local-dev-setup.md)

**Quick start (after first-time setup):**

```bash
# Build images from source (first time ~15 min, then ~30 sec)
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml --env-file deploy/.env.local build api web

# Start all 8 services
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml --env-file deploy/.env.local up -d

# Run DB migrations (required on first run)
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml --env-file deploy/.env.local exec -T api flask db upgrade
```

Open **http://localhost/apps**

```bash
# Stop
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml --env-file deploy/.env.local down
```

---

## Deployment (Production)

Production runs on EC2 at `13.232.39.143`. Deployment is fully automated:

```
git push origin main
  → GitHub Actions builds api + web Docker images
  → Pushes to AWS ECR
  → SSHes into EC2, pulls new images, restarts stack
```

**Push to `main` = deploy to production.** Treat it accordingly.

---

## Stack

| Service | Image | Role |
|---------|-------|------|
| `api` | `nexoraa/dify-api` (built from `api/`) | REST API + console backend |
| `worker` | `nexoraa/dify-api` | Celery background jobs |
| `web` | `nexoraa/dify-web` (built from `web/`) | Next.js frontend |
| `db` | `pgvector/pgvector:pg15` | Postgres + vector store |
| `redis` | `redis:6-alpine` | Cache + Celery broker |
| `plugin_daemon` | `langgenius/dify-plugin-daemon` | Plugin runtime |
| `sandbox` | `langgenius/dify-sandbox` | Sandboxed code execution |
| `nginx` | `nginx` | Reverse proxy on `:80` |

---

## Keeping in sync with upstream Dify

```bash
git fetch upstream
git checkout -b upstream-sync
git merge upstream/main
# resolve conflicts, then:
git checkout main
git merge upstream-sync
git push origin main
```

Upstream repo: https://github.com/langgenius/dify

---

## Useful commands

```bash
# View API logs
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml --env-file deploy/.env.local logs -f api

# Restart a single service
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml --env-file deploy/.env.local restart api

# Open a shell in the API container
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml --env-file deploy/.env.local exec api bash

# Check service status
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml --env-file deploy/.env.local ps
```
