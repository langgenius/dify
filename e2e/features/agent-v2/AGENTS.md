# Agent V2 E2E

This file scopes Agent v2 conventions under `features/agent-v2/` and its step definitions. Package-wide runner, locator, assertion, lifecycle, and cleanup rules live in `e2e/AGENTS.md`.

## Scope

Agent v2 scenarios use the `@agent-v2` capability tag. The E2E web environment enables Agent v2 through `NEXT_PUBLIC_ENABLE_AGENT_V2=true`.

Cover user-observable Configure, Build draft, saved configuration, publish, Access Point, files, advanced settings, and runtime behavior. Do not keep readiness-only, unavailable, or permanently skipped scenarios. Use API setup for prerequisites, then assert visible behavior or a persisted public contract.

## Execution tags

- `@core` — stable, non-runtime user behavior.
- `@prepared` — deterministic user behavior that requires the checked-in post-merge seed.
- `@external-model` — execution can call a real model provider.
- `@external-tool` — execution can call a real third-party tool provider.
- `@agent-backend-runtime` — execution requires the standalone `dify-agent` server and shellctl sandbox.
- `@web-app-runtime` — published Web app chat behavior.
- `@service-api-runtime` — Backend service API chat behavior.
- `@microphone` — isolated Chromium context with the fake audio fixture.

Fixture tags such as `@stable-model`, `@tool-fixture`, `@knowledge-fixture`, `@full-config-agent`, `@tool-states-agent`, `@dual-retrieval-fixture`, and `@workflow-reference` describe the concrete seeded dependency. They do not change execution by themselves.

Use `@external-model` and `@external-tool` only for runtime calls. A scenario that merely selects or persists an active model or tool is `@prepared`, not external.

## Step organization

Keep steps grouped by Agent product capability, such as configuration, Build draft, resource configuration, lifecycle, Access Point, and runtime behavior. Group by the domain action that owns the wording instead of mechanically pairing a step file with each feature file. Fixture-resolution steps should remain separate from behavior steps because they validate environment readiness rather than perform a user journey.

Cucumber step definitions are globally registered. Do not duplicate step text across files.

## World state

Agent v2 state belongs under `world.agentBuilder`:

- `fixtures` stores resolved models and seeded resources.
- `accessPoint`, `configure`, `speechToText`, and `workflow` store per-scenario state.

Do not add Agent v2 fields to the top level of `DifyWorld`. Store created Agent IDs, drive files, and tool credentials in the existing typed cleanup fields.

## Setup boundary

Use `a basic configured Agent v2 test agent has been created via API` for model-free, scenario-owned state. Use `a runnable Agent v2 test agent has been created via API` only after resolving the stable model fixture. Use the agent-decision variant only for autonomous planning or resource-selection behavior.

API setup may create scenario-owned Agents, workflows, drafts, access toggles, and files. Register every created resource for cleanup. Do not mutate a fixed seeded fixture to make a scenario pass.

Use `the Agent v2 configuration should be saved automatically` for Configure autosave. It waits for the visible publish-bar saved state; do not replace it with network-idle waits or internal store assertions.

## Seed and fixture contract

Seed scripts create or update environment-owned models, plugins, datasets, Agents, and workflows. `fixtures.steps.ts` resolves and validates those resources before a dependent behavior runs. Missing, inactive, unindexed, or drifted fixtures must throw and fail the scenario; never return `skipped`.

`@prepared` scenarios are excluded from deterministic PR core. Post-merge runs:

```bash
pnpm -C e2e e2e:post-merge:prepare
pnpm -C e2e e2e:post-merge
```

The strict seed must finish without blocked tasks. The concrete resource inventory and defaults belong to the seed profile and environment configuration rather than this guidance.

Organize fixture helpers by the product resource or infrastructure capability they own, not by the feature file that happens to consume them. Keep runtime readiness adapters separate from Console resource fixtures, and keep all fixture state in the current `SeedContext` or scenario `DifyWorld` rather than module globals.

Provider credentials belong to seed/admin setup, never to Cucumber steps.

## Runtime contract

Scenarios tagged `@agent-backend-runtime` must include `the Agent v2 runtime backend is available`. Run with `E2E_START_AGENT_BACKEND=1` to start `dify-agent` and shellctl, or point `E2E_AGENT_BACKEND_URL` / `AGENT_BACKEND_BASE_URL` to an existing server.

Use the stable model for generic runtime behavior and the decision model only where model reasoning quality is part of the contract. Do not broaden external runtime tags to cover configuration-only scenarios.

## Build and Preview

Build mode covers Configure and Build draft persistence. Preview/Test Run covers real generation, runtime failure recovery, and tool or knowledge hits proven through replies. Do not add Preview scenarios until they are executable in the selected CI lane.

## API contracts

Import generated Console/Web/Service API types directly from `@dify/contracts/.../types.gen`. Keep local types only for E2E-owned state, fixture registry entries, helper inputs, and intentionally narrowed views. If the generated contract is incomplete, fix the backend schema and regenerate it instead of duplicating the response shape.

Agent detail is the state owner for Agent scenarios. An Agent's backing app identifier may be used to route a shared app command, but it is not a substitute query model and must not become the final assertion source. Derive Agent Web app URLs and persisted Agent state from the generated Agent detail contract, then assert the user-visible Access Point or runtime result in the browser.
