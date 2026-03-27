# E2E

Repository-level E2E tests for Dify use Cucumber for scenarios and Playwright for browser execution.

## Architecture

- `features/`: Gherkin scenarios grouped by capability
- `features/step-definitions/`: domain-oriented step definitions
- `features/support/hooks.ts`: suite lifecycle, auth-state bootstrap, diagnostics
- `features/support/world.ts`: shared scenario context
- `support/web-server.ts`: typed frontend startup/reuse logic
- `scripts/*.sh`: middleware and backend orchestration

When you open `e2e/` as the VS Code workspace root, the official Cucumber extension works without custom editor settings because both `.feature` files and glue live under the conventional `features/` tree.

## Commands

```bash
cd e2e
pnpm install
pnpm e2e:install

# authenticated-only regression (default excludes @fresh)
pnpm e2e

# full reset + fresh install + authenticated scenarios
pnpm e2e:full

# run a tagged subset
pnpm e2e -- --tags @smoke

# headed browser
pnpm e2e:headed -- --tags @smoke
```

## Reports And Logs

- `cucumber-report/report.html`: human-readable HTML report
- `cucumber-report/report.json`: machine-readable report
- `cucumber-report/artifacts/`: saved screenshots and HTML dumps for failures
- `.logs/cucumber-api.log`: backend startup log
- `.logs/cucumber-web.log`: frontend startup log
- `.logs/web-server-manager.log`: typed web-server manager log

## Environment Notes

- Docker is required for middleware-backed flows.
- `pnpm e2e` expects middleware to already be running.
- `pnpm e2e:full` resets persisted state, recreates required Docker volume directories, starts middleware, and then runs the full suite.

See [AGENTS.md](./AGENTS.md) for the detailed lifecycle and local workflow.
