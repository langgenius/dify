# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Nexoraa's fork of [langgenius/dify](https://github.com/langgenius/dify) — the LLM application platform. Full source code plus Nexoraa's own deployment config and CI/CD. Changes here deploy to production at `13.232.39.143`.

**Push to `main` = deploy to production.** The CI pipeline builds Docker images → pushes to AWS ECR → restarts the EC2 stack automatically.

---

## Repo layout

| Path | What lives here |
|------|-----------------|
| `api/` | Python/Flask backend (DDD layered: controller → service → core) |
| `web/` | Next.js frontend (TypeScript/React, pnpm workspace) |
| `packages/` | Shared workspace packages: `dify-ui`, `contracts`, `tsconfig` |
| `deploy/` | Docker Compose stack + nginx config for EC2 |
| `.github/workflows/` | `build.yml` (build→ECR) and `deploy.yml` (EC2 restart) |
| `docs/runbooks/` | Operational guides for team members |
| `.claude/commands/` | `/dev-start` and `/dev-stop` Claude commands for local dev |

---

## Local development (full Docker stack)

```bash
# First time only: build images from source (~10-15 min)
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml --env-file deploy/.env.local build api web

# Start all 8 services
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml --env-file deploy/.env.local up -d

# Run DB migrations (first run only)
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml --env-file deploy/.env.local exec -T api flask db upgrade

# Stop
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml --env-file deploy/.env.local down
```

The `/dev-start` Claude command automates all of the above including auto-creating the admin account.

Default local credentials: `admin@nexoraa.local` / `nexoraa123` (set in `deploy/.env.local` via `SETUP_ADMIN_*`).

App runs at **http://localhost/apps**. Sessions last 30 days locally (`ACCESS_TOKEN_EXPIRE_MINUTES=43200` in `docker-compose.local.yml`).

---

## Backend (`api/`) commands

All backend commands use `uv` with `--project api`. Run from the repo root.

```bash
make format          # ruff format
make lint            # ruff format + ruff check --fix
make type-check      # pyrefly + mypy
make test            # all backend unit tests
make test TARGET_TESTS=./api/tests/path/to/test_file.py  # single test
```

Direct uv equivalents:
```bash
uv run --project api --dev ruff format ./api
uv run --project api --dev ruff check --fix ./api
uv --directory api run mypy ...
uv run --project api pytest api/tests/...
```

**Architecture:** Controller → Service → Core/Domain. Controllers parse input and delegate; services coordinate; `core/` holds domain logic, providers, and workflow engine. Config is always accessed via `configs.dify_config`, never `os.environ` directly.

**Key conventions** (full details in `api/AGENTS.md`):
- Line limit: 120 chars. Formatter: Ruff.
- SQLAlchemy: always scope by `tenant_id`; use context-manager sessions; prefer SQLAlchemy expressions over raw SQL.
- Background tasks: queue via `services/async_workflow_service`; implement under `tasks/`.
- Storage: `extensions.ext_storage.storage`. Outbound HTTP: `core.helper.ssrf_proxy`.
- Logging: module-level `logger = logging.getLogger(__name__)`; never `print`.

---

## Frontend (`web/`) commands

Run from `web/` or prefix with `pnpm -C web` from repo root.

```bash
pnpm dev             # start dev server
pnpm build           # production build
pnpm lint            # ESLint with auto-fix on staged files
pnpm lint:tss        # type-aware linting (slower, run before PR)
pnpm type-check      # TypeScript 7 (tsgo) full type check
pnpm test            # vitest unit tests
pnpm test path/to/file.spec.tsx   # single test file
pnpm test --watch    # watch mode
pnpm test --coverage # coverage report
```

**Architecture:** Next.js App Router. Route groups: `(commonLayout)` (authenticated app), `(shareLayout)` (public/auth pages), `(humanInputLayout)` (HITL forms). Auth is cookie-based; `AppInitializer` in `app/components/app-initializer.tsx` gates the app and redirects to `/install` or `/signin` as needed.

**Key conventions** (full details in `web/AGENTS.md`):
- UI primitives: import exclusively from `@langgenius/dify-ui/<subpath>` (no barrel import). Never import overlay components from `@/app/components/base/*` in new code.
- Overlay layering: use `z-50` / `z-60` only via `dify-ui` primitives; root must have `isolation: isolate`.
- Tests: `ComponentName.spec.tsx` in a sibling `__tests__/` folder. Global setup in `vitest.setup.ts`. Shared mocks in `web/__mocks__/`.
- Linting: commit hook runs ESLint auto-fix on staged files. Suppressions tracked in `eslint-suppressions.json`.

---

## CI/CD

Two workflows, both trigger on push to `main`:

- **`build.yml`** — fires only when `api/**` or `web/**` changed. Builds images via OIDC auth to AWS, pushes `nexoraa/dify-api` and `nexoraa/dify-web` to ECR (`ap-south-1`).
- **`deploy.yml`** — fires after `build.yml` succeeds, or on any `deploy/**` push. SSHes into EC2, runs `git fetch + reset --hard + clean -fd`, pulls new images, restarts the stack, runs migrations.

Required GitHub secrets: `AWS_ACCOUNT_ID`, `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`.

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

Nexoraa-specific files that will conflict: `deploy/`, `.github/workflows/`, `CLAUDE.md`, `README.md`, `web/tsconfig.json`. Keep our versions.

---

## docker-compose.local.yml vs docker-compose.yml

`docker-compose.yml` is the production config — it references ECR image URLs (`${ECR_REGISTRY}/nexoraa/dify-api:latest`). `docker-compose.local.yml` overrides image sources to build from source and sets `pull_policy: never` so Docker never attempts to pull locally-tagged images from Docker Hub. Always use both files together locally via `-f deploy/docker-compose.yml -f deploy/docker-compose.local.yml`.
