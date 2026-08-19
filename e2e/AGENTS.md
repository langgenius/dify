# E2E

This package contains Dify's repository-level Cucumber scenarios with Playwright as the browser layer. This file owns current package architecture, runtime, session and tag semantics, seed, protocol, and cleanup contracts. The repo-local `e2e-cucumber-playwright` skill owns authoring and review methodology; feature-specific facts belong in the nearest feature `AGENTS.md`.

## Commands

Run commands from the repository root. Install dependencies and browsers once with `pnpm install` and `pnpm -C e2e e2e:install`. Run only one local `pnpm -C e2e e2e*` process at a time because runners share ports, auth state, and log paths.

- Existing initialized instance: `pnpm -C e2e e2e`
- Standalone automated WCAG Level A scan: `pnpm -C e2e e2e:accessibility:a`
- Standalone automated WCAG Level AA scan: `pnpm -C e2e e2e:accessibility:aa`
- One-page automated WCAG scan: `pnpm -C e2e exec tsx ./scripts/run-cucumber.ts --full -- --tags "@axe and @wcag-a and @wcag-page-studio"` (replace the level and page tag as needed)
- Reset, initialize, and run deterministic scenarios: `pnpm -C e2e e2e:full`
- Prepare and run scenarios backed by shared fixtures: `E2E_START_AGENT_BACKEND=1 pnpm -C e2e e2e:prepared`
- Tagged subset: `pnpm -C e2e e2e -- --tags @smoke`
- Headed debugging: `pnpm -C e2e e2e:headed -- --tags @smoke`
- Prepare and run external runtime scenarios: `E2E_START_AGENT_BACKEND=1 pnpm -C e2e e2e:external`
- Seed against existing middleware without running Cucumber: `pnpm -C e2e seed -- --profile <prepared|external-runtime|post-merge>`
- Reset persisted E2E state: `pnpm -C e2e e2e:reset`
- Middleware lifecycle: `pnpm -C e2e e2e:middleware:up` and `pnpm -C e2e e2e:middleware:down`
- Scoped static checks: `vp check e2e`

The runner reuses `web/.next/BUILD_ID` when present. Set `E2E_FORCE_WEB_BUILD=1` to force a frontend rebuild. Use `E2E_BROWSER=webkit` for focused cross-browser runs and `E2E_SLOW_MO=500` with a headed command for local action debugging.

## Runtime Ownership

- `scripts/setup.ts` owns reset, middleware, backend, and frontend startup.
- `scripts/run-cucumber.ts` is the only E2E runtime orchestrator. It owns service lifetime, optional seed execution, Cucumber invocation, and teardown.
- `scripts/seed-runner.ts` owns fixture creation and verification against an already-running runtime; it never starts services.
- `support/web-server.ts` owns frontend reuse, readiness, and shutdown.
- `features/support/hooks.ts` owns shared auth bootstrap, scenario lifecycle, and diagnostics.
- `features/support/world.ts` owns `DifyWorld`, the per-scenario behavior `BrowserContext`, and its authenticated setup and cleanup client. Browser and API identities remain separate so unauthenticated and logout journeys cannot invalidate fixture ownership.
- Cross-actor scenarios keep each actor in a separate `BrowserContext` and typed `DifyWorld` state so diagnostics and cleanup cover every actor.
- `features/step-definitions/` contains capability-oriented glue; `common/` is reserved for genuinely cross-capability steps.
- Step definitions that access World state use `async function (this: DifyWorld, ...)`; arrow functions cannot receive Cucumber's bound World instance.

An uninitialized instance is installed and authenticated lazily; an initialized instance signs in and reuses authenticated state. Full runs prove reset and bootstrap during setup rather than through a Gherkin scenario. Cucumber's exit status is the behavior gate, and the runner also requires at least one `testCaseStarted` message so an empty tag selection cannot pass. Do not replace this gate with scenario-count baselines or skipped-scenario allowlists.

## Tags And External Runtime

- Default scenarios use shared authenticated storage state. `@unauthenticated` creates a clean context; `@authenticated` is an intent and selection tag only.
- `@axe` identifies standalone automated WCAG scans and is excluded from the default functional suite and normal CI commands. `@wcag-a` and `@wcag-aa` qualify the independent level-specific scans, and commands selecting either level must also select `@axe`. Page selectors use `@wcag-page-<slug>` and are attached to the matching Examples blocks under `features/accessibility/`. The accessibility workflow is an opt-in manual audit rather than a regression gate. The PR author should run the AA/all path before merge when changing the audit workflow, page matrix, or readiness contracts.
- `@prepared` requires the prepared fixtures; the post-merge seed profile includes them.
- `@external-model` and `@external-tool` identify scenarios that call real external runtimes. Deterministic commands exclude these tags; external commands are opt-in.
- `@microphone` uses the checked-in fake audio fixture and an isolated Chromium context.
- `@browser-smoke` runs focused keyboard and navigation coverage in Chromium and WebKit CI lanes.
- `@skip` temporarily excludes a scenario from every runner profile. Remove it as soon as the covered product behavior is available again; do not use it for permanent or environment-dependent suppression.
- Feature-owned services use their own tags. Agent v2 runtime scenarios use `@agent-backend-runtime` and require the explicit runtime-availability step. Set `E2E_START_AGENT_BACKEND=1` to start it locally, or provide `E2E_AGENT_BACKEND_URL` / `AGENT_BACKEND_BASE_URL`.

Seed and Cucumber must share one runtime lifecycle. Combined commands own reset, middleware, services, seed, Cucumber, and teardown; CI must not reproduce that lifecycle in workflow YAML. `E2E_START_AGENT_BACKEND=1` starts a managed local backend before the API; it is mutually exclusive with an explicit Agent backend URL.

Do not overload runtime tags to imply unrelated services or silently skip behavior when a required fixture is missing.

## Browser, API, And Contract Boundaries

The action under test belongs to the browser. APIs may prepare fixtures, poll persistence, and clean up; they do not replace the user's `When` action. Prefer a user-observable browser result unless persisted backend state is the contract under test.

For ordinary Console JSON and representable multipart operations, use the scenario- or process-owned generated oRPC client with request and response validation enabled. Call generated operations directly. Do not add handwritten endpoint URLs, duplicate DTOs or schemas, response casts, one-to-one forwarding wrappers, mutable cross-scenario clients, or TanStack Query caching.

Keep helpers only when they own fixture construction, multi-operation orchestration, cleanup registries, invariants, eventual-consistency polling, narrowed test views, or a protocol adapter. SSE, binary downloads, redirect-only flows, external services, and infrastructure readiness may use centralized adapters under their real owner.

Validation failures are contract failures. Trace them to the backend schema owner, update `api/controllers/API_SCHEMA_GUIDE.md` contracts when required, regenerate `@dify/contracts`, and keep the scenario aligned with the product's real state owner. Do not disable validation or add fallback schemas to make E2E pass.

## Seeds, Cleanup, And Diagnostics

- Generate disposable resource names through `support/naming.ts` with an `E2E` prefix.
- Keep deterministic upload material in `fixtures/test-materials/` and resolve it through `support/test-materials.ts`.
- Seed scripts own shared long-lived fixtures; scenarios own disposable resources they create and must register cleanup.
- Use typed `DifyWorld` cleanup fields for known resource types and `registerCleanup(...)` for additional lifecycle owners. Registered callbacks run LIFO after typed cleanup queues.
- Remove child and referencing resources before owners. Attach cleanup failures to the report instead of swallowing them.

Failures produce screenshots and HTML captures under `cucumber-report/artifacts/`; the HTML and Cucumber Messages reports live under `cucumber-report/`. Backend and frontend startup logs live under `.logs/`. Additional CI lanes preserve their own report and log directories.
