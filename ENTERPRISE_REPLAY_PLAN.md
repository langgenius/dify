# Enterprise Replay Plan

Base: official stable tag/tree `1.15.0` at `3aa26fb`

Candidate branch: `codex/enterprise-candidate-1.15.0-20260626`

Enterprise version: `1.15.0-enterprise`

Status: clean enterprise candidate rebuilt from the official stable release baseline. No business code should be changed before this plan and the enterprise maintenance documents are updated.

## Official 1.15.0 Upgrade Notes

- Run `flask db upgrade` after updating code. Local source validation should use `uv run --project api flask db upgrade`.
- Run `flask backfill-plugin-auto-upgrade` after the DB migration. This is mandatory because plugin auto-upgrade settings moved to a category-scoped model.
- Review Docker/env changes before starting compose: official `1.15.0` adds 19 env vars, removes 2, changes `UV_CACHE_DIR` from `/tmp/.uv-cache` to `/tmp/uv_cache`, and modifies compose files.
- Plugin daemon now supports `PIP_MIRROR_AUTO_DETECT` and `PIP_MIRROR_URL`; enterprise offline plugin install fixes should reuse those official knobs instead of carrying a parallel mirror mechanism.
- Preserve official security fixes, especially plugin-daemon forwarding path traversal CVE-2026-41948.
- Re-test workflow, dataset, plugin, and RAG paths touched by official `1.15.0`, including workflow reasoning/HITL/polling, spreadsheet image extraction, plugin OAuth/cache, dataset/RAG, and session-management refactors.

## Goal

Rebuild the enterprise branch from official stable `1.15.0`, replaying only the patches required to preserve enterprise workspace, platform-admin, 智慧广场, Docker/offline packaging, plugin offline install, and dataset/hit-testing behavior while keeping official `1.15.0` as the default source of truth.

## Branch Truth

- `codex/enterprise-candidate-1.15.0-20260626`: current candidate and active work surface.
- `main`: official development-state observation/sync branch only; not the enterprise release base.
- `enterprise/main`: long-term enterprise branch only after a clean candidate is promoted.
- `codex/enterprise-candidate-20260424` and `D:\CodexSpace\dify-enterprise-candidate-20260424`: historical `1.13.3` enterprise references only.

Agents must not use the old `1.13.3` candidate or dirty enterprise history as implementation source of truth. Copy only a named patch group or a change that has been re-proven by current-source tests, rebuilt enterprise images, browser clicks, and logs.

## Pull Request Safety

- Do not open pull requests against `langgenius/dify` for this enterprise candidate.
- Any PR must stay inside `D-S-William-Guo/dify`; both base and head repositories must be the enterprise fork.
- Ignore GitHub's automatic upstream PR suggestion after pushing an enterprise branch.
- If an upstream PR is created by mistake, close it immediately and leave a short mistake/withdrawal note.

## Replay Principles

- Start from official stable tag/tree and add enterprise behavior surgically.
- Prefer official `1.15.0` implementation unless an enterprise capability would break.
- Re-apply enterprise patches by capability area, not by copying the old tree.
- After each replay group, run the closest build/test/runtime check before moving on.
- Do not import local runtime artifacts, build caches, `node_modules`, Docker volumes, or old test-only drift.
- For local upgrade validation on the same development machine, migrate the previous stable enterprise `docker/.env` and `docker/volumes/**` into the new worktree before compose validation unless the official upgrade is explicitly destructive or the user asks for a reset.
- Treat copied local runtime data as validation input only; never commit it, package it, or use it as a source-tree patch source.
- Treat old route-2 performance work as optional historical guidance, not mandatory enterprise behavior.
- Prefer deleting stale assumptions over adapting the new candidate to old dirty-branch quirks.

## Must Replay Patch Groups

### 1. Enterprise Workspace Baseline

Purpose: preserve enterprise workspace behavior, default workspace joining, workspace/account compatibility, and platform-admin entry points.

Reference sources from the old `1.13.3` candidate:

- `api/services/account_service.py`
- `api/controllers/console/workspace/account.py`
- `api/controllers/console/workspace/__init__.py`
- `api/models/account.py`
- `web/context/workspace-context.ts`
- `web/app/components/header/account-setting/platform-admin-page/`
- `web/app/components/header/account-dropdown/workplace-selector/`

Validation:

- Fresh install creates account correctly.
- First login reaches official language/timezone completion when required.
- `/apps?action=showSettings&tab=provider` does not hit the Next error boundary.
- Workspace selector and account settings render without runtime errors.

### 2. 智慧广场 / Enterprise Marketplace

Purpose: preserve enterprise marketplace app submission, admin review/listing, explore marketplace navigation, and related backend APIs.

Reference sources from the old `1.13.3` candidate:

- `api/controllers/console/enterprise_marketplace.py`
- `api/services/enterprise_marketplace_service.py`
- `api/migrations/versions/2026_04_01_2100-c8f3d9d4a1be_add_enterprise_marketplace_assets.py`
- `web/app/(commonLayout)/explore/marketplace/page.tsx`
- `web/app/components/explore/enterprise-marketplace/`
- `web/app/components/apps/submit-enterprise-marketplace-modal.tsx`
- `web/app/components/header/enterprise-marketplace-nav/`
- `web/service/use-enterprise-marketplace.ts`

Validation:

- Marketplace API routes load.
- Enterprise app submission and admin review entry render.
- App can be submitted, reviewed by a platform admin, listed publicly, and copied by another account into a different workspace.

### 3. Docker / Offline Enterprise Packaging

Purpose: preserve deployment-safe enterprise packaging for online build machines and offline Linux targets. Do not carry machine-specific runtime hacks.

Reference sources from the old `1.13.3` candidate:

- `docker/docker-compose.enterprise.yaml`
- `docker/README.enterprise.md`
- `docker/scripts/build-enterprise-web.ps1`
- `scripts/build-enterprise-offline.ps1`
- `scripts/build-enterprise-offline.sh`
- `.dockerignore`
- `web/Dockerfile`
- `web/Dockerfile.dockerignore`

Validation:

- Enterprise API image builds as `dify-api-enterprise:1.15.0-enterprise`.
- Enterprise web image builds as `dify-web-enterprise:1.15.0-enterprise`.
- Compose services start without migration multiple-head errors.
- No local `docker/volumes/**` runtime data is required for a fresh deployment except documented config files.

### 4. Install / Sign-In / Public Route Regression Fixes

Purpose: keep fixes that are proven by runtime verification, without masking official setup flow behavior.

Reference sources from the old `1.13.3` candidate:

- `web/app/install/installForm.tsx`
- `web/app/signin/normal-form.tsx`
- `web/app/signin/one-more-step.tsx`
- `web/context/global-public-context.tsx`
- `web/service/base.ts`
- `web/service/fetch.ts`
- `web/service/system-features.ts`
- `web/service/use-common.ts`
- `api/services/account_service.py`

Validation:

- `/install` works on a clean database.
- Setup/login flow reaches the correct next step.
- `/apps` loads after initialization.
- Direct public/session-sensitive routes do not show blank/error pages.

### 5. User-Flagged Critical Regressions

Purpose: explicitly re-check previously fragile DSL and configuration areas against official `1.15.0` before carrying old hotfixes.

Reference sources from the old `1.13.3` candidate:

- `api/services/app_dsl_service.py`
- `web/app/components/app/configuration/hooks/use-configuration-utils.ts`

Validation:

- DSL import/export representative tests pass.
- Creating beginner apps such as text generation, agent, and chat assistant works.
- Configuration hook tests pass against current official behavior.

### 6. Workflow / Plugin / Dataset / Tool Compatibility

Purpose: carry only enterprise-required compatibility patches after official `1.15.0` behavior is understood.

Reference sources from the old `1.13.3` candidate:

- `api/controllers/console/app/workflow_draft_variable.py`
- `api/controllers/console/datasets/data_source.py`
- `api/controllers/console/datasets/hit_testing.py`
- `api/services/dataset_service.py`
- `api/services/tools/*_tools_manage_service.py`
- `api/core/workflow/`
- `web/app/components/workflow/`
- `web/app/components/plugins/`
- `web/app/components/datasets/`
- `web/app/components/tools/`

Validation:

- Representative workflow, dataset, plugin, and tool flow tests pass.
- Runtime clicks for dataset creation, hit testing, plugin local/offline install, tool provider detail, and workflow block selection work.

## Explicit Exclusions Unless Re-Proven Necessary

- `docker/.build/**`
- `docker/volumes/**` runtime data
- `docker/volumes/sandbox/dependencies/**`
- `packages/*/node_modules/**`
- `node_modules/**`
- `web/.next/**`
- `api/.venv/**`
- `.git/**`
- `web/.eslintcache`
- Broad UI-library migration edits that are not required by enterprise behavior or current official build
- Old tests that only assert pre-`1.15.0` APIs
- Local Windows-only runtime workarounds that would not apply to remote offline Linux deployment

## First Implementation Order

1. Replay documentation and Docker/offline packaging scaffolding that is source-safe.
2. Replay enterprise marketplace backend migration/service/controller.
3. Replay enterprise marketplace frontend navigation and pages.
4. Replay enterprise workspace/account behavior.
5. Re-check install/sign-in/public route behavior against official `1.15.0` first, then patch only proven regressions.
6. Re-check `app_dsl_service.py` and `use-configuration-utils.ts` before carrying any old hotfix.
7. Validate dataset/plugin/tool/workflow flows last, because these are broad upstream-moving areas.

## Promotion Checklist

Before this candidate becomes the new `enterprise/main`:

1. Remove local runtime-data deletions and other machine artifacts from the Git diff.
2. Commit only source, config, documentation, tests, migrations, and release scripts.
3. Confirm `api/pyproject.toml` and `web/package.json` both report `1.15.0`.
4. For local upgrade validation, stop compose, migrate the previous stable enterprise `docker/.env` and `docker/volumes/**` into the new worktree, update version-bearing `.env` values such as `DIFY_ENTERPRISE_VERSION`, then start compose from the new worktree only.
5. Confirm all running compose services use the new worktree bind mounts and the new enterprise API/Web image IDs; no service may keep an old worktree mount.
6. Rebuild enterprise `api` and `web` images as `1.15.0-enterprise`.
7. Force recreate `api`, `worker`, `worker_beat`, `web`, `plugin_daemon`, vector store, sandbox, ssrf proxy, and `nginx` as required by changed runtime surfaces and data-migration checks.
8. Verify migrated data is present, including accounts, workspaces, apps/workflows, datasets, installed plugins, and enterprise marketplace assets when available.
9. Repeat the verified runtime flows and inspect logs for new 500s, tracebacks, and Next error boundaries.
10. Export the offline image bundle with `Mode=reuse` from the same validated image IDs.
11. Protect the previous `enterprise/main` and promote this candidate by fork-internal PR, merge, or an explicitly approved branch reset. Never promote through an upstream `langgenius/dify` PR.
