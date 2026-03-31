# E2E

This package contains the repository-level end-to-end tests for Dify.

This file is the canonical package guide for `e2e/`. Keep detailed workflow, architecture, debugging, and reporting documentation here. Keep `README.md` as a minimal pointer to this file so the two documents do not drift.

The suite uses Cucumber for scenario definitions and Playwright as the browser execution layer.

It tests:

- backend API started from source
- frontend served from the production artifact
- middleware services started from Docker

## Prerequisites

- Node.js `^22.22.1`
- `pnpm`
- `uv`
- Docker

Run the following commands from the repository root.

Install Playwright browsers once:

```bash
pnpm install
pnpm -C e2e e2e:install
pnpm -C e2e check
```

`pnpm install` is resolved through the repository workspace and uses the shared root lockfile plus `pnpm-workspace.yaml`.

Use `pnpm check` as the default local verification step after editing E2E TypeScript, Cucumber support code, or feature glue. It runs formatting, linting, and type checks for this package.

Common commands:

```bash
# authenticated-only regression (default excludes @fresh)
# expects backend API, frontend artifact, and middleware stack to already be running
pnpm -C e2e e2e

# full reset + fresh install + authenticated scenarios
# starts required middleware/dependencies for you
pnpm -C e2e e2e:full

# run a tagged subset
pnpm -C e2e e2e -- --tags @smoke

# headed browser
pnpm -C e2e e2e:headed -- --tags @smoke

# slow down browser actions for local debugging
E2E_SLOW_MO=500 pnpm -C e2e e2e:headed -- --tags @smoke
```

Frontend artifact behavior:

- if `web/.next/BUILD_ID` exists, E2E reuses the existing build by default
- if you set `E2E_FORCE_WEB_BUILD=1`, E2E rebuilds the frontend before starting it

## Lifecycle

```mermaid
flowchart TD
  A["Start E2E run"] --> B["run-cucumber.ts orchestrates setup/API/frontend"]
  B --> C["support/web-server.ts starts or reuses frontend directly"]
  C --> D["Cucumber loads config, steps, and support modules"]
  D --> E["BeforeAll bootstraps shared auth state via /install"]
  E --> F{"Which command is running?"}
  F -->|`pnpm e2e`| G["Run config default tags: not @fresh and not @skip"]
  F -->|`pnpm e2e:full*`| H["Override tags to not @skip"]
  G --> I["Per-scenario BrowserContext from shared browser"]
  H --> I
  I --> J["Failure artifacts written to cucumber-report/artifacts"]
```

Ownership is split like this:

- `scripts/setup.ts` is the single environment entrypoint for reset, middleware, backend, and frontend startup
- `run-cucumber.ts` orchestrates the E2E run and Cucumber invocation
- `support/web-server.ts` manages frontend reuse, startup, readiness, and shutdown
- `features/support/hooks.ts` manages auth bootstrap, scenario lifecycle, and diagnostics
- `features/support/world.ts` owns per-scenario typed context
- `features/step-definitions/` holds domain-oriented glue so the official VS Code Cucumber plugin works with default conventions when `e2e/` is opened as the workspace root

Package layout:

- `features/`: Gherkin scenarios grouped by capability
- `features/step-definitions/`: domain-oriented step definitions
- `features/support/hooks.ts`: suite lifecycle, auth-state bootstrap, diagnostics
- `features/support/world.ts`: shared scenario context
- `support/web-server.ts`: typed frontend startup/reuse logic
- `scripts/setup.ts`: reset and service lifecycle commands
- `scripts/run-cucumber.ts`: Cucumber orchestration entrypoint

Behavior depends on instance state:

- uninitialized instance: completes install and stores authenticated state
- initialized instance: signs in and reuses authenticated state

Because of that, the `@fresh` install scenario only runs in the `pnpm e2e:full*` flows. The default `pnpm e2e*` flows exclude `@fresh` via Cucumber config tags so they can be re-run against an already initialized instance.

Reset all persisted E2E state:

```bash
pnpm -C e2e e2e:reset
```

This removes:

- `docker/volumes/db/data`
- `docker/volumes/redis/data`
- `docker/volumes/weaviate`
- `docker/volumes/plugin_daemon`
- `e2e/.auth`
- `e2e/.logs`
- `e2e/cucumber-report`

Start the full middleware stack:

```bash
pnpm -C e2e e2e:middleware:up
```

Stop the full middleware stack:

```bash
pnpm e2e:middleware:down
```

The middleware stack includes:

- PostgreSQL
- Redis
- Weaviate
- Sandbox
- SSRF proxy
- Plugin daemon

Fresh install verification:

```bash
pnpm e2e:full
```

Run the Cucumber suite against an already running middleware stack:

```bash
pnpm e2e:middleware:up
pnpm e2e
pnpm e2e:middleware:down
```

Artifacts and diagnostics:

- `cucumber-report/report.html`: HTML report
- `cucumber-report/report.json`: JSON report
- `cucumber-report/artifacts/`: failure screenshots and HTML captures
- `.logs/cucumber-api.log`: backend startup log
- `.logs/cucumber-web.log`: frontend startup log

Open the HTML report locally with:

```bash
open cucumber-report/report.html
```
