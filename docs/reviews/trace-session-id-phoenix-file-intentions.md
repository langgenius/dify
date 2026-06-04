# Trace Session ID Phoenix Feature File Intentions

## Scope

This document lists the intention of each file changed by the current `trace_session_id` / Phoenix session grouping feature, using the feature commit range from `e6c76cf945 feat: add trace session id request helper` through `HEAD`.

Excluded from this document: local dev-only uncommitted changes in `Makefile`, `docker/ssrf_proxy/squid.conf.template`, and `docker/volumes/phoenix/`.

Feature boundary: Agent App / dify-agent backend is out of scope for this feature. Workflow and chatflow paths are in scope.

Owner decision from grill-with-docs review: `trace_session_id` should affect existing app-generated `MESSAGE_TRACE`
spans when those traces are already emitted. The feature must not add extra message trace tasks, but existing
message/LLM spans should use the custom Phoenix `session.id` when metadata is present.

## Service API Entry Points

### `api/core/helper/trace_id_helper.py`

Intention: add the shared transport helper for `trace_session_id`.

- Defines the public header/body/query names and maximum length.
- Normalizes and validates the highest-priority input only: `X-Trace-Session-Id` header, then `trace_session_id` query parameter, then JSON body field.
- Provides `extract_trace_session_id_from_args()` so generators can move the normalized value into `extras`.
- Provides `omit_trace_session_id_from_payload()` so body values do not get DTO-validated before header/query priority is applied.

### `api/controllers/service_api/app/completion.py`

Intention: accept `trace_session_id` on completion and chat Service API generation requests.

- Adds the optional Pydantic field to completion and chat request payload models for documentation/contract clarity.
- Removes transport-level `trace_session_id` from payload validation before DTO parsing.
- Resolves the actual value through `get_trace_session_id(request)` and writes the normalized value into `args["trace_session_id"]`.
- Preserves existing `external_trace_id` behavior and generation flow.

### `api/controllers/service_api/app/workflow.py`

Intention: accept `trace_session_id` on workflow Service API generation requests.

- Adds the optional Pydantic field to workflow run payloads.
- Applies the same header > query > body resolution as completion/chat.
- Passes the normalized value into `args["trace_session_id"]` for both normal workflow run and workflow-run-by-id entry points.

## Generation Entity Propagation

### `api/core/app/apps/chat/app_generator.py`

Intention: carry the normalized session grouping value into chat app generation state.

- Extracts `trace_session_id` from `args`.
- Stores it in `ChatAppGenerateEntity.extras` alongside existing conversation-name behavior.

### `api/core/app/apps/agent_chat/app_generator.py`

Intention: carry `trace_session_id` through the legacy agent-chat app path that is still part of chatflow behavior.

- Extracts `trace_session_id` from generation args.
- Stores it in `AgentChatAppGenerateEntity.extras`.

### `api/core/app/apps/completion/app_generator.py`

Intention: carry `trace_session_id` through completion generation state.

- Extracts `trace_session_id` from generation args.
- Stores it in `CompletionAppGenerateEntity.extras`.

### `api/core/app/apps/advanced_chat/app_generator.py`

Intention: carry `trace_session_id` through advanced chat / chatflow workflow-backed generation paths.

- Adds extraction into normal advanced-chat `extras`.
- Adds debug/single-iteration/single-loop extraction for both mapping-style args and typed debug args.
- Keeps the value as trace metadata only, without changing conversation IDs or workflow IDs.

### `api/core/app/apps/workflow/app_generator.py`

Intention: carry `trace_session_id` through workflow generation, debug runs, and nested workflow setup.

- Adds extraction into workflow `extras` for normal workflow generation.
- Preserves existing `external_trace_id` and parent trace context handling.
- Adds debug/single-iteration/single-loop extraction for both mapping-style args and typed debug args.

### `api/core/app/apps/agent_app/app_generator.py`

Intention: remove Agent App participation from this feature.

- Keeps only existing `auto_generate_conversation_name` extras.
- Intentionally does not extract or store `trace_session_id`, because Agent App / dify-agent backend support is a separate workstream.

### `api/core/app/entities/app_invoke_entities.py`

Intention: add a typed runtime carrier for workflow graph execution.

- Adds `trace_session_id: str | None` to `DifyRunContext`.
- Extends `build_dify_run_context()` so workflow runners can pass the session grouping value into node runtime without using an untyped ad hoc dict at that boundary.

## Workflow Runtime Propagation

### `api/core/app/apps/workflow_app_runner.py`

Intention: pass `trace_session_id` into the graph init context for all workflow execution variants.

- Extends graph creation helpers with an optional `trace_session_id`.
- Propagates the value into `build_dify_run_context()`.
- Covers normal workflow graph runs and single-node iteration/loop debug runs.

### `api/core/app/apps/workflow/app_runner.py`

Intention: connect workflow generate entity extras to the shared workflow runner.

- Reads `trace_session_id` from `application_generate_entity.extras`.
- Passes it into normal workflow graph creation and single-node debug execution.

### `api/core/app/apps/advanced_chat/app_runner.py`

Intention: connect advanced-chat generate entity extras to workflow graph execution.

- Reads `trace_session_id` from advanced-chat `extras`.
- Passes it into graph creation for normal runs, start-node runs, and single iteration/loop debug runs.

### `api/core/workflow/node_runtime.py`

Intention: inherit the outer workflow `trace_session_id` when a workflow invokes another workflow as a tool.

- Adds `trace_session_id` to the workflow-tool runtime binding.
- Reads it from typed `DifyRunContext`.
- Sets or clears the value on workflow tools before invocation, matching existing parent trace context handling.

### `api/core/tools/workflow_as_tool/tool.py`

Intention: carry the parent workflow session grouping value into nested workflow generation without exposing it as tool input.

- Adds private `_trace_session_id` state.
- Copies it when the workflow tool is forked.
- Injects it into nested workflow generator args.
- Adds explicit setter/clearer methods so non-nested invocations do not leak stale session state.

## Trace Task And Phoenix Export

### `api/core/app/workflow/layers/persistence.py`

Intention: attach the session grouping value to workflow trace tasks.

- Reads `trace_session_id` from workflow or advanced-chat generate entity extras.
- Passes it to `TraceTaskName.WORKFLOW_TRACE`.
- Leaves parent trace context and external trace ID behavior intact.

### `api/core/app/task_pipeline/easy_ui_based_generate_task_pipeline.py`

Intention: attach session metadata to an existing message trace task without creating additional trace tasks.

- Passes `trace_session_id` into `TraceTaskName.MESSAGE_TRACE` from generate entity extras.
- This is intentional for plain chat/completion usefulness in Phoenix: when the path already emits `MESSAGE_TRACE`, its
  message/LLM spans should use the caller-provided session ID.
- The feature boundary is that no extra message trace task should be added solely for `trace_session_id`.

### `api/core/ops/ops_trace_manager.py`

Intention: move `trace_session_id` from trace task kwargs into provider-visible trace metadata.

- Adds typed helper logic to read a non-empty string from trace task kwargs.
- Adds `metadata["trace_session_id"]` to workflow trace info.
- Adds `metadata["trace_session_id"]` to existing message trace info when that trace task already carries the kwarg.

### `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`

Intention: map Dify `trace_session_id` metadata to Phoenix/OpenInference `session.id`.

- Adds centralized session resolution that prefers `metadata["trace_session_id"]`.
- Preserves existing workflow fallback order when no custom session is present.
- Preserves existing message fallback behavior when no custom session is present.
- Applies the resolved session ID to workflow root, workflow, node, message, and LLM spans where relevant.
- Adds an explicit `dict[str, Any]` annotation for LLM span attributes so mixed string/int OpenInference attributes type-check.

## Unit Tests

### `api/tests/unit_tests/core/helper/test_trace_id_helper.py`

Intention: test the shared parser/normalizer directly.

- Covers header > query > body priority.
- Covers trimming, invalid highest-priority input rejection, lower-priority invalid value ignoring, and non-interaction with `trace_id` / `traceparent`.
- Covers extraction from generation args.

### `api/tests/unit_tests/controllers/service_api/test_trace_session_id_parsing.py`

Intention: test controller-level behavior around DTO omission and request priority.

- Verifies invalid lower-priority body values do not block valid header/query values.
- Verifies invalid highest-priority query/body values are rejected before generation starts.
- Verifies completion, chat, and workflow controllers pass normalized `trace_session_id` into `AppGenerateService.generate()`.

### `api/tests/unit_tests/core/app/apps/test_trace_session_id_generate_extras.py`

Intention: cover the helper-level generator extras extraction contract.

- Verifies a trimmed `trace_session_id` becomes an `extras`-ready dict.

### `api/tests/unit_tests/core/app/apps/chat/test_app_generator_and_runner.py`

Intention: verify chat generator stores `trace_session_id` in the actual generated entity.

- Protects against regressions where the helper exists but `ChatAppGenerator` does not use it.

### `api/tests/unit_tests/core/app/apps/agent_chat/test_agent_chat_app_generator.py`

Intention: verify in-scope legacy agent-chat generator stores `trace_session_id` in generated entity extras.

- Keeps chatflow support covered while still excluding the newer Agent App backend path.

### `api/tests/unit_tests/core/app/apps/completion/test_completion_completion_app_generator.py`

Intention: verify completion generator stores `trace_session_id` in generated entity extras.

- Protects the non-workflow completion path from losing the session grouping value before tracing.

### `api/tests/unit_tests/core/app/apps/advanced_chat/test_app_generator.py`

Intention: verify advanced-chat generator propagation and existing behavior remain compatible.

- Adds or updates coverage for `trace_session_id` in advanced-chat extras, including debug-related paths where applicable.

### `api/tests/unit_tests/core/app/apps/workflow/test_app_generator_extra.py`

Intention: verify workflow generator extras and debug extraction behavior.

- Covers normal workflow generation.
- Covers single iteration/loop debug args and typed debug arg handling.

### `api/tests/unit_tests/core/app/apps/test_workflow_app_generator.py`

Intention: preserve workflow generator behavior while adding the new extras field.

- Updates existing expectations so `trace_session_id` can be present without changing unrelated generation semantics.

### `api/tests/unit_tests/core/app/apps/test_workflow_app_runner_core.py`

Intention: verify workflow runner passes `trace_session_id` into graph run context.

- Covers normal workflow runner paths.
- Covers single-node execution paths where the session value must still reach `DifyRunContext`.

### `api/tests/unit_tests/core/app/apps/test_workflow_app_runner_single_node.py`

Intention: preserve single-node workflow runner expectations after adding the optional context field.

- Updates existing runner tests for compatibility with the new propagation argument.

### `api/tests/unit_tests/core/app/layers/test_pause_state_persist_layer.py`

Intention: ensure paused/resumed workflow state preserves the generate entity extras carrying `trace_session_id`.

- Protects long-running workflow resume behavior from dropping the session grouping value.

### `api/tests/unit_tests/core/app/task_pipeline/test_easy_ui_based_generate_task_pipeline_core.py`

Intention: verify easy-UI message pipeline trace task behavior with `trace_session_id`.

- Ensures an existing message trace task path carries the session metadata consistently without requiring new trace tasks.

### `api/tests/unit_tests/core/app/workflow/test_persistence_layer.py`

Intention: verify workflow persistence creates trace tasks with `trace_session_id`.

- Protects the handoff from generate entity extras into `TraceTaskName.WORKFLOW_TRACE`.

### `api/tests/unit_tests/core/ops/test_trace_session_metadata.py`

Intention: verify trace task metadata construction.

- Checks workflow trace metadata includes `trace_session_id`.
- Checks existing message trace metadata receives the session value when a trace session is provided.

### `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

Intention: verify Phoenix/OpenInference session mapping.

- Covers metadata-preferred session resolution.
- Covers workflow root/workflow/node span session attributes.
- Covers message/LLM span session behavior for existing message traces.
- Protects existing fallback behavior when no custom session is provided.

### `api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py`

Intention: verify nested workflow-as-tool invocations inherit `trace_session_id`.

- Ensures the parent workflow session ID is injected into nested workflow generator args.
- Ensures forked workflow tools retain the session value.
- Ensures clearing prevents leakage outside traced nested execution.

### `api/tests/unit_tests/core/workflow/test_node_runtime.py`

Intention: verify node runtime binds workflow tool trace metadata correctly.

- Ensures `trace_session_id` from `DifyRunContext` is attached to workflow tool runtime binding.

### `api/tests/unit_tests/core/workflow/nodes/tool/test_tool_node_runtime.py`

Intention: verify tool node invocation sets and clears `trace_session_id` on workflow tools.

- Protects nested workflow propagation.
- Protects non-workflow or untraced tool calls from stale state leakage.

### `api/tests/unit_tests/core/app/apps/agent_app/test_app_generator.py`

Intention: lock Agent App out of this feature.

- Verifies Agent App generated extras do not include `trace_session_id`.
- Documents the current boundary that dify-agent backend support is not part of this feature.

## Feature Docs And Review Docs

### `docs/superpowers/specs/2026-06-03-trace-session-id-design.md`

Intention: record the feature design and boundary decisions.

- Defines `trace_session_id` as observability grouping metadata, not Dify business identity or trace identity.
- Documents supported inputs, priority, Phoenix behavior, nested workflow inheritance, backwards compatibility, and explicit non-goals.
- Clarifies that app generation should not add new message traces for this feature, while existing message traces can use
  the custom session grouping value.

### `docs/superpowers/specs/2026-06-03-trace-id-alignment-reference.md`

Intention: align `trace_session_id` semantics with existing `trace_id` behavior without conflating them.

- Documents the propagation chain.
- Clarifies that existing message trace support is part of the custom session grouping behavior but not a reason to
  enqueue extra message traces.

### `docs/superpowers/plans/2026-06-03-trace-session-id-implementation.md`

Intention: keep the implementation plan aligned with the final scoped behavior.

- Tracks the intended file changes and test plan.
- Updates wording from broad workflow/message trace enqueueing to workflow trace metadata plus existing message-trace
  metadata when that task is already emitted.
- Records API documentation requirements.

### `docs/reviews/trace-session-id-phoenix-feature-review.md`

Intention: preserve the subagent-driven code review result and owner decisions.

- Lists reviewed issues, resolution status, and remaining test gap.
- Records the owner decision that Agent App / dify-agent backend is out of scope.
- Records verification commands and outcomes.

## Public API Documentation Templates

### `web/app/components/develop/template/template.en.mdx`

Intention: document `trace_session_id` input support for the general Service API template in English.

### `web/app/components/develop/template/template.ja.mdx`

Intention: document the same general Service API `trace_session_id` input support in Japanese.

### `web/app/components/develop/template/template.zh.mdx`

Intention: document the same general Service API `trace_session_id` input support in Chinese.

### `web/app/components/develop/template/template_advanced_chat.en.mdx`

Intention: document `trace_session_id` input support for advanced chat Service API requests in English.

### `web/app/components/develop/template/template_advanced_chat.ja.mdx`

Intention: document advanced chat `trace_session_id` input support in Japanese.

### `web/app/components/develop/template/template_advanced_chat.zh.mdx`

Intention: document advanced chat `trace_session_id` input support in Chinese.

### `web/app/components/develop/template/template_chat.en.mdx`

Intention: document `trace_session_id` input support for chat Service API requests in English.

### `web/app/components/develop/template/template_chat.ja.mdx`

Intention: document chat `trace_session_id` input support in Japanese.

### `web/app/components/develop/template/template_chat.zh.mdx`

Intention: document chat `trace_session_id` input support in Chinese.

### `web/app/components/develop/template/template_workflow.en.mdx`

Intention: document `trace_session_id` input support for workflow Service API requests in English, including the supported header/query/body priority.

### `web/app/components/develop/template/template_workflow.ja.mdx`

Intention: document workflow `trace_session_id` input support in Japanese.

### `web/app/components/develop/template/template_workflow.zh.mdx`

Intention: document workflow `trace_session_id` input support in Chinese.
