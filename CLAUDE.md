# CLAUDE.md

This is the Nexoraa fork of Dify — full source code plus deployment config.

## Repo Structure

- `api/` — Dify backend (Python/Flask). See `api/README.md` for dev setup.
- `web/` — Dify frontend (Next.js). See `web/README.md` for dev setup.
- `deploy/` — Docker Compose stack, nginx config, and env template for EC2 deployment.
- `.github/workflows/build.yml` — Builds api + web Docker images and pushes to ECR.
- `.github/workflows/deploy.yml` — SSHes into EC2 and restarts the stack after a build.

## Deployment

Push to `main` triggers:
1. `build.yml` — if `api/**` or `web/**` changed: builds images → pushes to ECR
2. `deploy.yml` — SSHes into EC2, pulls new images, restarts stack

EC2 host: `13.232.39.143`. The `.env` file lives on the EC2 host (never committed).

## Local Dev

See `api/README.md` and `web/README.md` for running services individually.
For the full stack locally: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d`

## Upstream Sync

To pull Dify upstream updates:
```bash
git fetch upstream
git checkout -b upstream-sync
git merge upstream/main
# resolve conflicts, then:
git checkout main
git merge upstream-sync
```
