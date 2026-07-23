# Generate Conversation Name Parent Tracing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach asynchronous conversation-title generation beneath the current message span and keep it in the current conversation Thread for unified LangSmith and Phoenix tracing.

**Architecture:** Propagate the existing message ID through the title-generation Timer and trace task. Mark canonical message roots as context publishers, make generate-name traces require that provider context, and reuse the Core Parent Context Coordinator plus existing Celery retry contract to restore provider-specific parent state.

**Tech Stack:** Python 3.12, Pydantic, Celery, Redis, LangSmith SDK, OpenTelemetry, pytest.

---

### Task 1: Propagate message ID into GenerateNameTraceInfo

**Files:**
- Modify: `api/core/app/task_pipeline/message_cycle_manager.py`
- Modify: `api/core/app/task_pipeline/easy_ui_based_generate_task_pipeline.py`
- Modify: `api/core/app/apps/advanced_chat/generate_task_pipeline.py`
- Modify: `api/core/llm_generator/llm_generator.py`
- Modify: `api/core/ops/ops_trace_manager.py`
- Test: `api/tests/unit_tests/core/app/task_pipeline/test_message_cycle_manager_optimization.py`
- Test: `api/tests/unit_tests/core/app/task_pipeline/test_easy_ui_based_generate_task_pipeline_core.py`
- Test: `api/tests/unit_tests/core/app/apps/advanced_chat/test_generate_task_pipeline.py`
- Test: `api/tests/unit_tests/core/llm_generator/test_llm_generator.py`
- Test: `api/tests/unit_tests/core/ops/test_ops_trace_manager.py`

- [ ] Add failing tests proving the pipeline, Timer, worker, `TraceTask`, and `GenerateNameTraceInfo` retain `message_id="message-1"`.
- [ ] Run the focused tests and confirm failures are caused by missing optional parameters.
- [ ] Add optional `message_id` parameters to `MessageCycleManager.generate_conversation_name`, `_generate_conversation_name_worker`, and `LLMGenerator.generate_conversation_name`.
- [ ] Pass each pipeline's existing `_message_id`, place it on the `TraceTask`, and set `message_id=self.message_id` on `GenerateNameTraceInfo`.
- [ ] Run the focused tests and commit:

```bash
git add api/core/app/task_pipeline/message_cycle_manager.py \
  api/core/app/task_pipeline/easy_ui_based_generate_task_pipeline.py \
  api/core/app/apps/advanced_chat/generate_task_pipeline.py \
  api/core/llm_generator/llm_generator.py api/core/ops/ops_trace_manager.py \
  api/tests/unit_tests/core/app/task_pipeline/test_message_cycle_manager_optimization.py \
  api/tests/unit_tests/core/app/task_pipeline/test_easy_ui_based_generate_task_pipeline_core.py \
  api/tests/unit_tests/core/app/apps/advanced_chat/test_generate_task_pipeline.py \
  api/tests/unit_tests/core/llm_generator/test_llm_generator.py \
  api/tests/unit_tests/core/ops/test_ops_trace_manager.py
git commit -m "feat(trace): propagate title generation message context"
```

### Task 2: Model canonical message context publication and title requirements

**Files:**
- Modify: `api/core/ops/unified_trace/entities.py`
- Modify: `api/core/ops/unified_trace/trace_builder.py`
- Test: `api/tests/unit_tests/core/ops/unified_trace/test_entities.py`
- Test: `api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py`

- [ ] Add failing tests for these backwards-compatible defaults:

```python
assert span.publishes_parent_context is False
assert trace.required_parent_context_id is None
```

- [ ] Add failing builder tests proving message roots publish context and generate-name traces use `message_id` as parent/required context plus `conversation_id` as session.
- [ ] Add fields:

```python
class CanonicalSpan(BaseModel):
    publishes_parent_context: bool = False

class CanonicalTrace(BaseModel):
    required_parent_context_id: str | None = None
```

- [ ] Mark workflow-message and standalone-message roots as publishers. Build generate-name with:

```python
return self._single_trace(
    trace_info,
    name="generate_name",
    kind=CanonicalSpanKind.TOOL,
    inputs=trace_info.inputs,
    outputs=trace_info.outputs,
    parent_id=trace_info.message_id,
    session_id=_single_session_id(trace_info) or trace_info.conversation_id or "",
    required_parent_context_id=trace_info.message_id,
)
```

Extend `_single_trace` with the optional `required_parent_context_id` argument and copy it into `CanonicalTrace`.
- [ ] Run builder/entity tests and commit:

```bash
git add api/core/ops/unified_trace/entities.py api/core/ops/unified_trace/trace_builder.py \
  api/tests/unit_tests/core/ops/unified_trace/test_entities.py \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py
git commit -m "feat(trace): model asynchronous message children"
```

### Task 3: Resolve required message contexts through Core

**Files:**
- Modify: `api/core/ops/unified_trace/parent_context.py`
- Modify: `api/core/ops/unified_trace/provider.py`
- Test: `api/tests/unit_tests/core/ops/unified_trace/test_parent_context.py`
- Test: `api/tests/unit_tests/core/ops/unified_trace/test_provider.py`

- [ ] Add failing coordinator tests for `resolve_required("message-1", ...)`: restore matching context, retry missing context/Redis failures, and reject malformed or wrong-scope context.
- [ ] Add failing runtime tests proving `required_parent_context_id` is resolved before adapter emission.
- [ ] Extract the existing Redis read/validation portion into a private `_restore(parent_context_id, expected_provider, expected_scope)` method and expose:

```python
def resolve_required(
    self,
    parent_context_id: str,
    *,
    expected_provider: str,
    expected_scope: str,
) -> ParentResolution:
    return ParentResolution.restored(
        self._restore(parent_context_id, expected_provider=expected_provider, expected_scope=expected_scope)
    )
```

Keep nested-workflow destination checks in `resolve` before calling the same private helper.
- [ ] In `UnifiedTraceInstance.trace`, use existing workflow resolution first, otherwise resolve `required_parent_context_id`.
- [ ] Run coordinator/runtime tests and commit:

```bash
git add api/core/ops/unified_trace/parent_context.py api/core/ops/unified_trace/provider.py \
  api/tests/unit_tests/core/ops/unified_trace/test_parent_context.py \
  api/tests/unit_tests/core/ops/unified_trace/test_provider.py
git commit -m "feat(trace): coordinate asynchronous message children"
```

### Task 4: Publish and restore message context in both adapters

**Files:**
- Modify: `api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py`
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/unified_trace.py`
- Test: `api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py`
- Test: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py`

- [ ] Add failing tests proving a message publisher invokes `publish_parent_context` with LangSmith dotted order and Phoenix `traceparent` only after provider emission succeeds.
- [ ] Add a LangSmith test proving empty canonical sessions do not write `metadata["session_id"]`.
- [ ] Change both publication conditions to:

```python
if canonical_span.can_parent_workflow or canonical_span.publishes_parent_context:
```

- [ ] Guard LangSmith root session metadata:

```python
if canonical_span.id == trace.root_span_id and trace.session_id:
    metadata["session_id"] = trace.session_id
```

Keep root-only external trace/link metadata handling outside that session guard.
- [ ] Run both adapter files and commit:

```bash
git add api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py \
  api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/unified_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py
git commit -m "feat(trace): attach title spans to message parents"
```

### Task 5: Verify

- [ ] Run all affected tests:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/app/task_pipeline/test_message_cycle_manager_optimization.py \
  api/tests/unit_tests/core/app/task_pipeline/test_easy_ui_based_generate_task_pipeline_core.py \
  api/tests/unit_tests/core/app/apps/advanced_chat/test_generate_task_pipeline.py \
  api/tests/unit_tests/core/llm_generator/test_llm_generator.py \
  api/tests/unit_tests/core/ops/test_ops_trace_manager.py \
  api/tests/unit_tests/core/ops/unified_trace \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py -q
```

- [ ] Run Ruff on changed Python files and `make type-check PATH_TO_CHECK` for production paths.
- [ ] Confirm only `docker/ssrf_proxy/squid.conf.template` remains as an intentional local-only modification.
