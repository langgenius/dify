# Agent V2 E2E

This file scopes Agent v2 E2E conventions for `e2e/features/agent-v2/` and its step definitions under `e2e/features/step-definitions/agent-v2/`. Keep package-wide runner, lifecycle, hook, fixture, locator, assertion, and cleanup rules in `e2e/AGENTS.md`.

Do not add deeper `AGENTS.md` files unless an Agent v2 submodule becomes independently owned.

## Scope

Agent v2 scenarios live under `features/agent-v2/` and use the `@agent-v2` capability tag.

The E2E web environment enables Agent v2 through `NEXT_PUBLIC_ENABLE_AGENT_V2=true` in `scripts/common.ts`, because `/roster` routes are guarded by that feature flag.

Preview/Test Run scenarios are not part of the current build-mode slice unless explicitly requested. Current Agent v2 coverage should prioritize Configure, Build draft, saved configuration display, publish state, Access Point, preflight, files, advanced settings, and other build-mode behavior. Published Web app runtime is not Builder Preview; keep it as a separate `@web-app-runtime` slice because it exercises the public app surface and real model-backed responses after publish.

Use API setup for prerequisite state, then use Playwright only for user-observable navigation, editing, and assertions. Do not make assertions pass by mirroring the current implementation blindly; if a failure exposes a product ambiguity, resource gap, or test-quality problem, identify the owner before changing the test.

## Tags

Use tags in three layers:

- Capability tags describe the product area: `@build`, `@files`, `@advanced-settings`, `@agent-edit`, `@publish`, `@access-point`, `@output-variables`, and similar tags.
- Execution-scope tags describe how the scenario should be selected: `@core`, `@infra`, `@web-app-runtime`, `@service-api-runtime`, `@preview`, and `@feature-gated`.
- Narrow fixture or sub-surface tags describe a specific dependency or slice: `@stable-model`, `@skill-fixture`, `@web-app-access`, `@workflow-reference`, `@files-limits`, and similar tags.

- `@agent-v2` — required capability tag for all Agent v2 scenarios.
- `@core` — stable non-runtime scenario expected to run in the regular Agent v2 suite when its explicit preconditions are met. Do not apply `@core` to Preview/Test Run, Web app chat runtime, or Backend service API chat runtime scenarios.
- `@infra` — infrastructure or readiness checks.
- `@build` — Build mode and Build draft behavior.
- `@build-unavailable-resources` — feature-gated Build chat recovery when the user requests unavailable Skills or Tools.
- `@files` — Files section upload, display, and fixture behavior.
- `@files-limits` — feature-gated file format, size, count, and in-progress upload limit behavior.
- `@knowledge` — Knowledge Retrieval configuration display, persistence, and reference cleanup.
- `@advanced-settings` — Env Editor, Content Moderation, and related Advanced Settings behavior.
- `@agent-create` — Agent Roster creation and initial Configure navigation.
- `@agent-edit` — saved Agent detail/configuration display surfaces.
- `@publish` — publish and publish-bar state.
- `@access-point` — Web app, Backend service API, and Workflow access surfaces.
- `@stable-model` — active model fixture dependency. Apply this to every scenario that includes `the Agent Builder stable chat model is available` or otherwise requires an active model configured in the workspace.
- `@tool-fixture` — preseeded Tool dependency such as `JSON Process / JSON Replace` or `Tavily / Tavily Search`.
- `@skill-fixture` — checked-in or preseeded Skill dependency such as `e2e-summary-skill`.
- `@knowledge-fixture` — preseeded dataset dependency such as `E2E Agent Knowledge Base`.
- `@full-config-agent` — fixed `E2E New Agent Builder Full Config` Agent dependency.
- `@tool-states-agent` — fixed `E2E New Agent Builder Tool States` Agent dependency.
- `@file-tree-fixture` — fixed file-tree Agent drive/config-files dependency.
- `@dual-retrieval-fixture` — fixed dual Knowledge Retrieval Agent dependency.
- `@backend-api-access` — fixed or scenario-owned Backend service API access dependency.
- `@published-web-app` — fixed or scenario-owned published Web app access dependency.
- `@web-app-runtime` — published public Web app runtime behavior. Use it for scenarios that open the public Web app and assert real chat responses. Access Point URL, launch, customization, and settings surfaces remain `@access-point` behavior unless they send messages through the public Web app.
- `@service-api-runtime` — Backend service API runtime behavior. Use it for scenarios that call the published service API and assert real chat responses. Endpoint display, copy, API key, and API reference surfaces remain `@access-point` behavior.
- `@feature-gated` — product capability is optional. This tag alone does not skip execution; the scenario must include an explicit step that returns `skipped` with a blocked-precondition reason when the feature is unavailable.

Use feature-level `@core` only when every scenario in the file is stable, non-runtime, and not feature-gated. If a feature file mixes stable scenarios with runtime, Preview, or feature-gated scenarios, put `@core` only on the stable scenarios. Keep runtime tags scenario-level so the regular core suite cannot inherit them accidentally.

## Step Organization

Keep Agent v2 step definitions grouped by user capability, not by DOM component or Cucumber keyword:

- `configure.steps.ts` — common configure navigation, refresh, autosave, and normal draft assertions.
- `build-draft.steps.ts` — Build mode checkout, apply, discard, supported writeback, and Build draft isolation.
- `files.steps.ts` — Files upload, display, and fixture-list assertions.
- `knowledge.steps.ts` — Knowledge Retrieval configuration persistence and reference cleanup.
- `tools.steps.ts` — Tools selector, search, and configuration-boundary behavior.
- `advanced-settings.steps.ts` — common Advanced Settings shell and supported-entry assertions.
- `env-editor.steps.ts` — Env Editor add, import, delete, persistence, and restored-display behavior.
- `content-moderation.steps.ts` — Content Moderation availability, keyword settings, and feature-gated assertions.
- `agent-roster.steps.ts` — Agent Roster creation and Roster-level user actions.
- `agent-edit.steps.ts` — saved Agent detail display assertions.
- `publish.steps.ts` — publish and publish-bar assertions.
- `access-point.steps.ts` — common Access Point navigation and overview.
- `access-point-web-app.steps.ts` — Web app access entrypoints and public Web app assertions.
- `access-point-service-api.steps.ts` — Backend service API entrypoints, keys, API reference, and service requests.
- `access-point-workflow.steps.ts` — Workflow access references.
- `preflight.steps.ts` — explicit `Given` entrypoints for Agent Builder preflight resources.

Cucumber step definitions are globally registered. Do not duplicate the same step text across files, even if one is written as `Given` and another as `Then`.

## World State

`DifyWorld` owns generic scenario state such as `page`, `context`, errors, downloads, cleanup queues, and created resource IDs.

Agent v2 business state belongs under `world.agentBuilder`; do not keep adding Agent v2-specific fields to the top level of `DifyWorld`.

Use the existing namespace shape:

- `world.agentBuilder.preflight.stableModel`
- `world.agentBuilder.preflight.brokenModel`
- `world.agentBuilder.preflight.preseededResources`
- `world.agentBuilder.accessPoint.serviceApiBaseURL`
- `world.agentBuilder.accessPoint.generatedApiKey`
- `world.agentBuilder.accessPoint.serviceApiResponse`
- `world.agentBuilder.accessPoint.apiReferencePage`
- `world.agentBuilder.accessPoint.webAppPage`
- `world.agentBuilder.accessPoint.webAppURL`
- `world.agentBuilder.accessPoint.workflowReferencePage`
- `world.agentBuilder.accessPoint.composerDraftSnapshot`
- `world.agentBuilder.configure.concurrentPage`
- `world.agentBuilder.workflow.agentConsolePage`
- `world.agentBuilder.workflow.outputVariables`

Use `features/agent-v2/support/agent.ts` for Agent v2 core API fixtures. It owns roster-shaped Agent IDs, configure/access route helpers, composer draft sync, version details, workflow references, publish, and Agent cleanup. Use `features/agent-v2/support/agent-soul.ts` for reusable Agent Soul fixture configuration, prompts, and model/dataset config builders. Use `features/agent-v2/support/agent-build-draft.ts` for Build draft checkout/save/discard API helpers. Use `features/agent-v2/support/agent-drive.ts` for Agent drive/config file and Skill upload plus cleanup helpers. Use `features/agent-v2/support/access-point.ts` for Web app access, Backend service API access, API keys, and service API request helpers. Store created roster Agent IDs in `DifyWorld.createdAgentIds`; the shared `After` hook deletes them after each scenario.

Use `DifyWorld.createdAgentDriveFiles` for Agent drive files committed during a scenario and `DifyWorld.createdBuiltinToolCredentials` for built-in tool credentials created during a scenario. The shared `After` hook deletes Agent drive files first so cleanup also works for scenarios that upload into a preseeded Agent.

## Setup Boundary

Use `a basic configured Agent v2 test agent has been created via API` when a scenario only needs a created Agent with a composer draft. Do not use that basic shell for runtime, model, tool, skill, knowledge, environment variable, moderation, or output-variable coverage until those resources have explicit seed helpers and readiness checks.

Use `a runnable Agent v2 test agent has been created via API` after `the Agent Builder stable chat model is available` when a scenario needs a real model-backed Agent. The step writes the preflight model into the Agent Soul model config through `features/agent-v2/support/agent-soul.ts` with deterministic E2E model settings; do not duplicate provider/model payload construction in individual steps.

Use `the Agent v2 configuration should be saved automatically` after UI edits that rely on Configure autosave. It waits for the user-visible publish bar saved state; do not replace it with network-idle waits or internal store checks.

API setup is acceptable for creating scenario-owned Agents, enabling Backend service API, writing composer drafts, seeding Build drafts, and preparing fixed state. The scenario must still assert user-visible behavior or a real persisted product contract through the public Console API. Do not assert only that a setup API call succeeded.

Do not use scenario API setup to repair an environment-owned Agent Builder seed. If a scenario depends on a fixed Agent, dataset, workflow, Skill, Tool, credential, published Web app, or active model, use the matching preflight step to verify it and block when it is missing or drifted. Create or mutate resources only when they are scenario-owned and registered for cleanup.

## API Contract Types

Agent v2 support helpers consume Console API contracts from `@dify/contracts/api/console/.../types.gen`. When a generated request, response, or payload type exists, import and use that exact type name at the helper boundary. Do not keep an old local response type name as an alias for the generated type.

Keep local types for Agent v2 E2E-owned state only, such as `DifyWorld.agentBuilder` state, scenario preflight resource records, fixture registry entries, helper input options, and deliberately narrowed test view models. If an endpoint response needs a field that the generated contract does not expose yet, fix the backend schema and regenerate contracts before broadening E2E types.

## Build Mode And Preview

Build mode scope means:

- Configure page behavior.
- Build draft checkout, pending state, apply, discard, and route isolation.
- Supported Build draft writeback for files, skills, and env.
- Saved configuration display after apply/discard/refresh.

Preview/Test Run scope means:

- Model-backed runtime responses.
- Duplicate run prevention.
- Runtime failure recovery.
- Tool/knowledge hit behavior proven through Agent replies.

Keep Preview/Test Run scenarios out of the current build-mode slice unless the task explicitly reintroduces them.

## Preflight Resources

Agent Builder resource checks live under `features/agent-v2/support/preflight/`. Import from the specific module that owns the resource contract; do not add a preflight barrel file:

- `models.ts`
- `agents.ts`
- `datasets.ts`
- `tools.ts`
- `access.ts`

`preflight.steps.ts` should remain the explicit `Given` entrypoint. Do not move preflight into hidden hooks.

Agent Builder preflight is read-only. It checks long-lived seed resources and records their IDs or normalized metadata for later steps, but it must not create missing resources, toggle fixed access settings, upload missing Skills/files, publish fixed Agents, or patch model/provider credentials. Seed creation and repair belong to the environment setup process, not to Cucumber scenarios.

Use `the Agent Builder stable chat model is available` before scenarios that need a real Agent Soul model configuration. This includes true runtime scenarios, model-backed build-mode assertions, and Workflow Agent v2 node setup because the backend rejects Agent nodes without model config. Do not add the model preflight to pure navigation or identity checks unless the setup API itself requires model config. `E2E_STABLE_MODEL_PROVIDER`, `E2E_STABLE_MODEL_NAME`, and optional `E2E_STABLE_MODEL_TYPE` are selectors for a model already configured in the workspace; they are not provider credentials. The step defaults to `openai` / `gpt-5.4-mini` / `llm`, verifies the selected model is present and `active` through `/console/api/workspaces/current/models/model-types/{type}`, then stores it on `DifyWorld.agentBuilder.preflight.stableModel`.

Keep `@stable-model` on Build draft apply scenarios that click `Apply`. The current product path calls `/build-chat/finalize` before applying the draft, and the backend returns `model is required` when the Agent Soul has no model config. Discard-only and pending-draft isolation scenarios can stay model-free when they do not finalize the Build draft.

Do not pass model provider API keys through Cucumber or Playwright env vars. Provider credentials belong to the Dify environment seed/admin setup. If the selected provider/model is missing or inactive, the scenario must be blocked by preflight instead of trying to create or patch provider credentials during the test.

Override the default selector only when a scenario or environment explicitly needs a different stable model:

```bash
E2E_STABLE_MODEL_PROVIDER=openai
E2E_STABLE_MODEL_NAME=gpt-5.4-mini
E2E_STABLE_MODEL_TYPE=llm
```

Dify may expose OpenAI as either `openai` or a plugin provider ID such as `langgenius/openai/openai`. The preflight accepts both forms for selection and stores the actual Console API provider ID for Agent Soul setup.

Use `the Agent Builder broken chat model is available` before model-recovery scenarios that intentionally start from an invalid model. The step requires `E2E_BROKEN_MODEL_PROVIDER`, defaults `E2E_BROKEN_MODEL_NAME` to `e2e-broken-model`, defaults `E2E_BROKEN_MODEL_TYPE` to `llm`, and only verifies that the model entry exists. The scenario must still assert the user-visible failure and recovery behavior.

Use `the Agent Builder preseeded Agent "{name}" is available`, `the Agent Builder preseeded workflow "{name}" is available`, `the Agent Builder preseeded dataset "{name}" is available`, and `the Agent Builder preseeded tool "{provider} / {tool}" is available` when a scenario depends on a fixed environment resource. These steps verify the resource through Console APIs, store the result in `DifyWorld.agentBuilder.preflight.preseededResources`, and return `skipped` when the resource is missing.

Use `the Agent Builder preseeded dataset "{name}" is indexed and ready` for knowledge retrieval scenarios that require a completed knowledge base. It verifies that the dataset exists, has documents, all listed documents are available, and every document indexing status is `completed`. For `E2E Agent Knowledge Base`, it also verifies through the Console segment list API that at least one enabled segment contains `AGENT_KNOWLEDGE_PASS`.

Use `the Agent Builder preseeded dataset "{name}" is indexing` for failure-recovery scenarios that require an indexing or queued knowledge base. It verifies at least one document is in `waiting`, `parsing`, `cleaning`, `splitting`, or `indexing`.

`e2e-summary-skill` has two separate E2E contracts. The checked-in package under `e2e/fixtures/test-materials/e2e-summary-skill/SKILL.md` is used by scenario-owned Agents to verify that the Skill package can be uploaded to an Agent drive. Fixed display/configuration scenarios use `e2e-summary-skill` as a preseeded resource: the environment-owned `E2E New Agent Builder Full Config` Agent must already include that drive-backed Skill before the scenario starts. Do not mutate fixed preseeded Agents during a scenario to add missing Skills.

Use `the Agent Builder preseeded Agent "{agent}" includes drive skill "{skill}"` to verify that a fixed Agent has a drive-backed Skill attached. If it is missing, return a blocked precondition owned by seed/product instead of uploading the Skill into the fixed Agent.

Use `the Agent Builder preseeded Agent "{agent}" has Backend service API access with an API key` to verify that a fixed Agent has Backend service API enabled and at least one key. The API key step does not validate a human-readable key name because the Console API key response does not expose one.

Use `the Agent Builder preseeded Agent "{agent}" includes the core fixture configuration` for the fixed Full Config Agent prerequisite. It composes the stable model, Summary Skill, JSON Replace tool, and indexed knowledge-base preflights, then reads `/console/api/agent/{agent_id}/composer` to verify the Agent Soul contains the selected model, prompt success token, required file fixtures, JSON Replace tool entry, and knowledge dataset reference. Do not use this step for Agent node output variables; those live in workflow node-job `declared_outputs`, not the roster Agent App composer response.

Use `the Agent Builder preseeded Agent "{agent}" includes the tool state fixture configuration` for the fixed Tool States Agent prerequisite. It composes the Summary Skill, JSON Replace tool, and Tavily Search tool preflights, then reads `/console/api/agent/{agent_id}/composer` to verify the Agent Soul includes JSON Replace, Tavily Search, and a Tavily credential reference. This proves the seed is configured to exercise tool status UI; keep actual invalid-credential errors in dependent user-visible configuration or runtime scenarios.

Use `the Agent Builder preseeded Agent "{agent}" includes the dual retrieval fixture configuration` for the fixed Dual Retrieval Agent prerequisite. It composes the indexed knowledge-base preflight, then reads `/console/api/agent/{agent_id}/composer` to verify `agent_soul.knowledge.sets` includes both an Agent-decide generated query set and a custom user-query set using the fixed custom query.

Use `the Agent Builder preseeded Agent "{agent}" includes the file tree fixture files` for file-tree display prerequisites. It verifies the Agent drive contains every file from `agentBuilderFileTreeFixtureFiles` through `/console/api/agent/{agent_id}/drive/files?prefix=files/`.

Use `the Agent Builder preseeded Agent "{agent}" includes the current flat file fixture configuration` for the current Agent Edit Files section. Agent config files are still a flat `config_files` list and reject path separators, so this preflight verifies the fixture file basenames are present in the Agent Soul. Treat this as partial coverage for tree-display requirements until the product supports hierarchical config files in the visible Files section.

Use `the Agent Builder preseeded Agent "{agent}" has published Web app access` to verify that a fixed Agent is published, Web app access is enabled, and the Agent detail response includes the site token and base URL needed to open the Web app.

Use `the Agent Builder preseeded Agent "{agent}" is referenced by workflow "{workflow}"` to verify Workflow access prerequisites. It checks both fixed resources exist, then uses `/console/api/agent/{agent_id}/referencing-workflows`, the same Console API used by the Access Point Workflow references table, to verify the workflow references the Agent through at least one published Agent node.

Run `pnpm -C e2e e2e -- --tags @agent-v2-preflight` against a seeded environment to verify Agent Builder preseeded resource readiness before running dependent scenarios. Keep each resource as a separate preflight scenario so a missing resource marks only its dependent precondition as blocked instead of hiding the rest of the readiness report.

## Blocked And Partial Policy

Use explicit skipped steps for missing resources, disabled feature flags, and product capabilities that are not currently implemented. `@feature-gated` is only a label; it is not execution semantics.

Blocked messages should be specific enough to route ownership:

```text
Blocked precondition: <resource> missing <capability>. Owner: seed/product. Remediation: <what to seed or decide>.
```

Order blocked steps by the real owner of the first unresolved condition. If a scenario is not automatable yet because the product behavior or test fixture contract is undefined, put that explicit availability step before model/tool/dataset preflights so the report is not masked by an unrelated missing seed. If the scenario is otherwise automatable and only depends on an external seed resource, run the matching resource preflight before creating scenario-owned state.

Use partial coverage only when current product behavior is intentionally narrower than the written requirement and the test still asserts a real user-visible behavior. Example: Files are currently flat in Agent config files, so the flat Files list can be asserted while tree display remains blocked until product support exists.

File format, size, count, and in-progress upload limit cases are feature-gated until the product exposes stable Agent config file restrictions and user-visible recovery/error states. Do not convert `@files-limits` scenarios to passing tests by relying on default environment behavior; first align the product contract or seed configuration.

Do not mark a scenario as complete if it only proves setup state and does not assert the user-visible behavior or persisted product contract required by the case.
