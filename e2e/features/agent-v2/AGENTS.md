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

Keep steps grouped by user capability:

- `configure.steps.ts` — navigation, editing, autosave, and saved draft behavior.
- `build-draft.steps.ts` — checkout, apply, discard, and isolation.
- `files.steps.ts`, `knowledge.steps.ts`, `tools.steps.ts` — resource configuration behavior.
- `advanced-settings.steps.ts`, `env-editor.steps.ts` — supported Advanced Settings behavior.
- `agent-roster.steps.ts`, `agent-edit.steps.ts`, `publish.steps.ts` — Agent lifecycle surfaces.
- `access-point*.steps.ts` — Web app, service API, and Workflow access.
- `fixtures.steps.ts` — strict fixture resolution for behavior scenarios.
- `speech-to-text.steps.ts` — voice input and transcription behavior.

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

The strict seed must finish without blocked tasks. It prepares the stable and decision models, Speech-to-Text default, marketplace plugins, JSON Replace and Tavily tools, ready knowledge base, Full Config Agent, Tool States Agent, Dual Retrieval Agent, and Workflow reference.

Fixture helpers live under `features/agent-v2/support/fixtures/`:

- `models.ts` — stable, decision, and Speech-to-Text models.
- `agents.ts` — fixed Agent and configuration contracts.
- `datasets.ts` — indexed knowledge contract.
- `tools.ts` — installed built-in tool contract.
- `access.ts` — Workflow reference contract.
- `agent-backend.ts` — runtime server and shellctl readiness.

The stable model selectors default to `openai` / `gpt-5-nano` / `llm`. The decision model defaults to `openai` / `gpt-5.5` / `llm`. The Speech-to-Text model defaults to `openai` / `gpt-4o-mini-transcribe`. Provider credentials belong to seed/admin setup through `E2E_MODEL_PROVIDER_CREDENTIALS_JSON`, never to Cucumber steps.

The Full Config Agent contract includes the stable model, prompt marker, checked-in files, Summary Skill, JSON Replace tool, and indexed knowledge reference. Tool States includes Summary Skill, JSON Replace, Tavily, and its credential reference. Dual Retrieval includes generated-query and custom-query knowledge sets. Workflow reference verifies the same Console API used by the Access Point table.

## Runtime contract

Scenarios tagged `@agent-backend-runtime` must include `the Agent v2 runtime backend is available`. Run with `E2E_START_AGENT_BACKEND=1` to start `dify-agent` and shellctl, or point `E2E_AGENT_BACKEND_URL` / `AGENT_BACKEND_BASE_URL` to an existing server.

Use the stable model for generic runtime behavior and the decision model only where model reasoning quality is part of the contract. Do not broaden external runtime tags to cover configuration-only scenarios.

## Build and Preview

Build mode covers Configure and Build draft persistence. Preview/Test Run covers real generation, runtime failure recovery, and tool or knowledge hits proven through replies. Do not add Preview scenarios until they are executable in the selected CI lane.

## API contracts

Import generated Console/Web/Service API types directly from `@dify/contracts/.../types.gen`. Keep local types only for E2E-owned state, fixture registry entries, helper inputs, and intentionally narrowed views. If the generated contract is incomplete, fix the backend schema and regenerate it instead of duplicating the response shape.
