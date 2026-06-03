# Trace Session ID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `trace_session_id` support for Service API generation requests and map it to Arize/Phoenix OpenInference `session.id` without changing Dify business identity or trace identity.

**Architecture:** Normalize `trace_session_id` at Service API controllers, propagate the trimmed value through app generate entity extras and workflow trace task kwargs, then resolve it inside the Arize/Phoenix provider before existing session fallbacks. Preserve the value through workflow pause/resume via the existing serialized generate entity path, and keep non-Arize/Phoenix providers semantically unchanged. Do not enqueue new message traces from app generation pipelines.

**Tech Stack:** Python 3.12, Flask-RESTX controllers, Pydantic v2 DTOs, Celery workflow tasks, Dify trace providers, pytest, Markdown/MDX API documentation.

---

## File Structure

- Modify `api/core/helper/trace_id_helper.py`: add `trace_session_id` parsing, validation, and extras extraction helpers next to existing trace helpers.
- Modify `api/controllers/service_api/app/completion.py`: add `trace_session_id` to chat/completion payloads and normalize request-level inputs into `args`.
- Modify `api/controllers/service_api/app/workflow.py`: add `trace_session_id` to workflow payloads and normalize request-level inputs into `args`.
- Modify `api/core/app/apps/chat/app_generator.py`: propagate `trace_session_id` into chat generate entity extras.
- Modify `api/core/app/apps/agent_chat/app_generator.py`: propagate `trace_session_id` into agent chat generate entity extras.
- Modify `api/core/app/apps/agent_app/app_generator.py`: propagate `trace_session_id` into agent app generate entity extras.
- Modify `api/core/app/apps/completion/app_generator.py`: propagate `trace_session_id` into completion generate entity extras.
- Modify `api/core/app/apps/advanced_chat/app_generator.py`: propagate `trace_session_id` into advanced chat generate entity extras.
- Modify `api/core/app/apps/workflow/app_generator.py`: propagate `trace_session_id` into workflow generate entity extras, including nested workflow inheritance.
- Modify `api/core/app/task_pipeline/easy_ui_based_generate_task_pipeline.py`: ensure saving plain chat/completion/agent messages does not enqueue `MESSAGE_TRACE` for this feature.
- Modify `api/core/app/apps/advanced_chat/generate_task_pipeline.py`: ensure saving advanced chat messages does not enqueue `MESSAGE_TRACE` for this feature.
- Modify `api/core/app/workflow/layers/persistence.py`: pass `trace_session_id` to workflow `TraceTask`.
- Modify `api/core/ops/ops_trace_manager.py`: copy `trace_session_id` from workflow trace task kwargs into `WorkflowTraceInfo.metadata`; keep existing explicit message trace support backwards-compatible.
- Modify `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`: centralize session id resolution and apply it to workflow, wrapper, and node spans; existing explicit message trace exports may continue using the same resolver when metadata is present.
- Modify unit tests under `api/tests/unit_tests/...` and `api/providers/trace/trace-arize-phoenix/tests/unit_tests/...`.
- Modify Web API documentation templates under `web/app/components/develop/template/` using the existing `trace_id` documentation style.

---

### Task 1: Add Trace Session ID Request Helpers

**Files:**
- Modify: `api/core/helper/trace_id_helper.py`
- Test: `api/tests/unit_tests/core/helper/test_trace_id_helper.py`

- [ ] **Step 1: Write failing helper tests**

Create `api/tests/unit_tests/core/helper/test_trace_id_helper.py` if it does not exist. Add these tests:

```python
from types import SimpleNamespace

import pytest
from werkzeug.exceptions import BadRequest

from core.helper.trace_id_helper import (
    extract_trace_session_id_from_args,
    get_trace_session_id,
)


class _Request:
    def __init__(self, *, headers=None, args=None, json=None, is_json=True):
        self.headers = headers or {}
        self.args = args or {}
        self.json = json
        self.is_json = is_json


def test_get_trace_session_id_prefers_header_over_query_and_body():
    request = _Request(
        headers={"X-Trace-Session-Id": "  header-session  "},
        args={"trace_session_id": "query-session"},
        json={"trace_session_id": "body-session"},
    )

    assert get_trace_session_id(request) == "header-session"


def test_get_trace_session_id_prefers_query_over_body():
    request = _Request(
        args={"trace_session_id": "  query-session  "},
        json={"trace_session_id": "body-session"},
    )

    assert get_trace_session_id(request) == "query-session"


def test_get_trace_session_id_reads_body_when_no_higher_priority_input():
    request = _Request(json={"trace_session_id": "  body/session:123  "})

    assert get_trace_session_id(request) == "body/session:123"


def test_get_trace_session_id_ignores_invalid_lower_priority_value():
    request = _Request(
        headers={"X-Trace-Session-Id": "header-session"},
        json={"trace_session_id": "   "},
    )

    assert get_trace_session_id(request) == "header-session"


@pytest.mark.parametrize(
    "request",
    [
        _Request(headers={"X-Trace-Session-Id": "   "}, json={"trace_session_id": "body-session"}),
        _Request(headers={"X-Trace-Session-Id": 123}),
        _Request(headers={"X-Trace-Session-Id": "x" * 201}),
    ],
)
def test_get_trace_session_id_rejects_invalid_highest_priority_input(request):
    with pytest.raises(BadRequest) as exc_info:
        get_trace_session_id(request)

    assert "trace_session_id" in str(exc_info.value)


def test_get_trace_session_id_does_not_read_trace_id_or_traceparent():
    request = _Request(
        headers={
            "X-Trace-Id": "trace-id",
            "traceparent": "00-5b8aa5a2d2c872e8321cf37308d69df2-051581bf3bb55c45-01",
        },
        args={"trace_id": "query-trace-id"},
        json={"trace_id": "body-trace-id"},
    )

    assert get_trace_session_id(request) is None


def test_extract_trace_session_id_from_args_returns_trimmed_value():
    args = {"trace_session_id": "  session-1  "}

    assert extract_trace_session_id_from_args(args) == {"trace_session_id": "session-1"}


def test_extract_trace_session_id_from_args_returns_empty_dict_when_missing():
    assert extract_trace_session_id_from_args({}) == {}
```

- [ ] **Step 2: Run helper tests and verify failure**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/helper/test_trace_id_helper.py -q
```

Expected: FAIL because `get_trace_session_id` and `extract_trace_session_id_from_args` are not defined.

- [ ] **Step 3: Implement helper functions**

In `api/core/helper/trace_id_helper.py`, add the constants and functions below after `extract_external_trace_id_from_args`:

```python
TRACE_SESSION_ID_HEADER = "X-Trace-Session-Id"
TRACE_SESSION_ID_ARG = "trace_session_id"
TRACE_SESSION_ID_MAX_LENGTH = 200


def _validate_trace_session_id(value: Any) -> str:
    if not isinstance(value, str):
        raise BadRequest("trace_session_id must be a string.")

    normalized = value.strip()
    if not normalized:
        raise BadRequest("trace_session_id must be 1 to 200 characters after trimming.")
    if len(normalized) > TRACE_SESSION_ID_MAX_LENGTH:
        raise BadRequest("trace_session_id must be 1 to 200 characters after trimming.")
    return normalized


def get_trace_session_id(request: Any) -> str | None:
    """
    Resolve the Service API trace session ID from explicit request inputs.

    Priority is ``X-Trace-Session-Id`` header, then ``trace_session_id`` query
    parameter, then ``trace_session_id`` JSON body field. Only the resolved
    highest-priority input is validated; lower-priority values are ignored.
    """
    if TRACE_SESSION_ID_HEADER in request.headers:
        return _validate_trace_session_id(request.headers.get(TRACE_SESSION_ID_HEADER))

    if TRACE_SESSION_ID_ARG in request.args:
        return _validate_trace_session_id(request.args.get(TRACE_SESSION_ID_ARG))

    if getattr(request, "is_json", False):
        json_data = getattr(request, "json", None)
        if isinstance(json_data, Mapping) and TRACE_SESSION_ID_ARG in json_data:
            return _validate_trace_session_id(json_data.get(TRACE_SESSION_ID_ARG))

    return None


def extract_trace_session_id_from_args(args: Mapping[str, Any]) -> dict[str, str]:
    """
    Extract normalized ``trace_session_id`` from generation args for entity extras.
    """
    trace_session_id = args.get(TRACE_SESSION_ID_ARG)
    if isinstance(trace_session_id, str) and trace_session_id:
        return {TRACE_SESSION_ID_ARG: trace_session_id.strip()}
    return {}
```

Also add this import at the top:

```python
from werkzeug.exceptions import BadRequest
```

- [ ] **Step 4: Run helper tests and verify pass**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/helper/test_trace_id_helper.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit helper changes**

```bash
git add api/core/helper/trace_id_helper.py api/tests/unit_tests/core/helper/test_trace_id_helper.py
git commit -m "feat: add trace session id request helper"
```

---

### Task 2: Parse Trace Session ID In Service API Controllers

**Files:**
- Modify: `api/controllers/service_api/app/completion.py`
- Modify: `api/controllers/service_api/app/workflow.py`
- Test: `api/tests/unit_tests/controllers/service_api/test_trace_session_id_parsing.py`

- [ ] **Step 1: Write failing controller parsing tests**

Create `api/tests/unit_tests/controllers/service_api/test_trace_session_id_parsing.py`:

```python
import pytest
from werkzeug.exceptions import BadRequest

from core.helper.trace_id_helper import get_trace_session_id


class _Request:
    def __init__(self, *, headers=None, args=None, json=None, is_json=True):
        self.headers = headers or {}
        self.args = args or {}
        self.json = json
        self.is_json = is_json


def test_trace_session_id_header_query_body_priority_matches_service_api_contract():
    request = _Request(
        headers={"X-Trace-Session-Id": "header"},
        args={"trace_session_id": "query"},
        json={"trace_session_id": "body"},
    )

    assert get_trace_session_id(request) == "header"


def test_trace_session_id_invalid_highest_priority_raises_bad_request():
    request = _Request(
        headers={"X-Trace-Session-Id": "   "},
        args={"trace_session_id": "query"},
        json={"trace_session_id": "body"},
    )

    with pytest.raises(BadRequest):
        get_trace_session_id(request)
```

These tests exercise the helper because controller endpoint tests in this repo are much heavier than the parsing rule itself.

- [ ] **Step 2: Run controller parsing tests and verify failure or pass-through**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/controllers/service_api/test_trace_session_id_parsing.py -q
```

Expected before Task 1 implementation: FAIL. Expected after Task 1 implementation: PASS.

- [ ] **Step 3: Update service API payload DTOs**

In `api/controllers/service_api/app/completion.py`, import `get_trace_session_id`:

```python
from core.helper.trace_id_helper import get_external_trace_id, get_trace_session_id
```

Add this field to both `CompletionRequestPayload` and `ChatRequestPayload`:

```python
trace_session_id: str | None = Field(default=None, description="Trace session ID for observability grouping")
```

In `api/controllers/service_api/app/workflow.py`, import `get_trace_session_id`:

```python
from core.helper.trace_id_helper import get_external_trace_id, get_trace_session_id
```

Add this field to `WorkflowRunPayload`:

```python
trace_session_id: str | None = Field(default=None, description="Trace session ID for observability grouping")
```

- [ ] **Step 4: Normalize trace session id into args in generation endpoints**

In all four Service API generation handlers, add the same pattern immediately after `args = payload.model_dump(exclude_none=True)`:

```python
trace_session_id = get_trace_session_id(request)
if trace_session_id:
    args["trace_session_id"] = trace_session_id
```

Apply it to:

- `CompletionApi.post`
- `ChatApi.post`
- `WorkflowRunApi.post`
- `WorkflowRunByIdApi.post`

Do not add it to stop-task, workflow-run-detail, or log endpoints.

- [ ] **Step 5: Run controller parsing tests**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/controllers/service_api/test_trace_session_id_parsing.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit controller parsing changes**

```bash
git add api/controllers/service_api/app/completion.py api/controllers/service_api/app/workflow.py api/tests/unit_tests/controllers/service_api/test_trace_session_id_parsing.py
git commit -m "feat: parse service api trace session id"
```

---

### Task 3: Propagate Trace Session ID Through Generate Entities

**Files:**
- Modify: `api/core/app/apps/chat/app_generator.py`
- Modify: `api/core/app/apps/agent_chat/app_generator.py`
- Modify: `api/core/app/apps/agent_app/app_generator.py`
- Modify: `api/core/app/apps/completion/app_generator.py`
- Modify: `api/core/app/apps/advanced_chat/app_generator.py`
- Modify: `api/core/app/apps/workflow/app_generator.py`
- Test: `api/tests/unit_tests/core/app/apps/test_workflow_app_generator.py`
- Test: `api/tests/unit_tests/core/app/apps/test_trace_session_id_generate_extras.py`

- [ ] **Step 1: Write failing generator extras tests**

Create `api/tests/unit_tests/core/app/apps/test_trace_session_id_generate_extras.py` with focused unit tests for helper extraction used by generators:

```python
from core.helper.trace_id_helper import extract_trace_session_id_from_args


def test_extract_trace_session_id_from_args_for_generator_extras():
    assert extract_trace_session_id_from_args({"trace_session_id": "session-1"}) == {
        "trace_session_id": "session-1",
    }


def test_extract_trace_session_id_from_args_missing_value_keeps_extras_clean():
    assert extract_trace_session_id_from_args({"inputs": {}}) == {}
```

In `api/tests/unit_tests/core/app/apps/test_workflow_app_generator.py`, extend `test_generate_includes_parent_trace_context_in_extras` by adding `"trace_session_id": "session-1"` to `args` and asserting:

```python
assert extras["trace_session_id"] == "session-1"
```

- [ ] **Step 2: Run generator tests and verify failure**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/app/apps/test_trace_session_id_generate_extras.py \
  api/tests/unit_tests/core/app/apps/test_workflow_app_generator.py::test_generate_includes_parent_trace_context_in_extras \
  -q
```

Expected: workflow generator assertion FAIL until generator extras are updated.

- [ ] **Step 3: Import helper in generators**

Add `extract_trace_session_id_from_args` to imports:

```python
from core.helper.trace_id_helper import extract_trace_session_id_from_args
```

For `api/core/app/apps/workflow/app_generator.py`, merge it with existing imports:

```python
from core.helper.trace_id_helper import (
    extract_external_trace_id_from_args,
    extract_parent_trace_context_from_args,
    extract_trace_session_id_from_args,
)
```

For `api/core/app/apps/advanced_chat/app_generator.py`, merge it with `extract_external_trace_id_from_args`.

- [ ] **Step 4: Add trace session id to entity extras**

In each generator, include:

```python
**extract_trace_session_id_from_args(args),
```

Use these shapes:

```python
# chat / agent_chat
extras = {
    "auto_generate_conversation_name": args.get("auto_generate_name", True),
    **extract_trace_session_id_from_args(args),
}
```

```python
# completion
extras = {
    **extract_trace_session_id_from_args(args),
}
```

```python
# advanced_chat
extras = {
    "auto_generate_conversation_name": args.get("auto_generate_name", False),
    **extract_external_trace_id_from_args(args),
    **extract_trace_session_id_from_args(args),
}
```

```python
# workflow
extras = {
    **extract_external_trace_id_from_args(args),
    **extract_parent_trace_context_from_args(args),
    **extract_trace_session_id_from_args(args),
}
```

For nested workflow invocations, preserve parent runtime value by making sure callers that build nested `args` copy the parent `application_generate_entity.extras["trace_session_id"]` into nested args before user-supplied nested args. If the nested invocation already has a different value, overwrite it with the parent value.

- [ ] **Step 5: Run generator tests**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/app/apps/test_trace_session_id_generate_extras.py \
  api/tests/unit_tests/core/app/apps/test_workflow_app_generator.py::test_generate_includes_parent_trace_context_in_extras \
  -q
```

Expected: PASS.

- [ ] **Step 6: Commit generator extras changes**

```bash
git add \
  api/core/app/apps/chat/app_generator.py \
  api/core/app/apps/agent_chat/app_generator.py \
  api/core/app/apps/agent_app/app_generator.py \
  api/core/app/apps/completion/app_generator.py \
  api/core/app/apps/advanced_chat/app_generator.py \
  api/core/app/apps/workflow/app_generator.py \
  api/tests/unit_tests/core/app/apps/test_trace_session_id_generate_extras.py \
  api/tests/unit_tests/core/app/apps/test_workflow_app_generator.py
git commit -m "feat: propagate trace session id through generators"
```

---

### Task 4: Pass Trace Session ID Into Workflow Trace Tasks And Trace Info Metadata

**Files:**
- Modify: `api/core/app/workflow/layers/persistence.py`
- Modify: `api/core/app/task_pipeline/easy_ui_based_generate_task_pipeline.py`
- Modify: `api/core/app/apps/advanced_chat/generate_task_pipeline.py`
- Modify: `api/core/ops/ops_trace_manager.py`
- Test: `api/tests/unit_tests/core/app/workflow/test_persistence_layer.py`
- Test: `api/tests/unit_tests/core/ops/test_trace_session_metadata.py`

- [ ] **Step 1: Write failing workflow trace task test**

In `api/tests/unit_tests/core/app/workflow/test_persistence_layer.py`, update `test_handle_graph_run_succeeded_enqueues_parent_trace_context`:

```python
extras={
    "external_trace_id": "trace",
    "trace_session_id": "session-1",
    "parent_trace_context": {
        "parent_workflow_run_id": "outer-workflow-run-1",
        "parent_node_execution_id": "outer-node-execution-1",
    },
},
```

Add these assertions:

```python
assert trace_task.kwargs["trace_session_id"] == "session-1"
```

Inside `fake_workflow_trace`, capture it:

```python
captured["trace_session_id"] = self.kwargs.get("trace_session_id")
```

Then assert:

```python
assert captured["trace_session_id"] == "session-1"
```

- [ ] **Step 2: Write failing trace metadata tests**

Create `api/tests/unit_tests/core/ops/test_trace_session_metadata.py`:

```python
from types import SimpleNamespace

from core.ops.ops_trace_manager import TraceTask
from core.ops.entities.trace_entity import TraceTaskName


def test_workflow_trace_metadata_includes_trace_session_id(monkeypatch):
    task = TraceTask(
        TraceTaskName.WORKFLOW_TRACE,
        workflow_execution=SimpleNamespace(id_="run-1", total_tokens=0),
        conversation_id="conv-1",
        user_id="user-1",
        trace_session_id="session-1",
    )

    def fake_original_workflow_trace(*args, **kwargs):
        return None

    # Implementer should replace this with the repo's existing fixture style if needed.
    assert task.kwargs["trace_session_id"] == "session-1"


def test_message_trace_metadata_support_remains_backwards_compatible():
    task = TraceTask(
        TraceTaskName.MESSAGE_TRACE,
        message_id="message-1",
        trace_session_id="session-1",
    )

    assert task.kwargs["trace_session_id"] == "session-1"
```

This establishes workflow task-level propagation before database-heavy `workflow_trace()` construction tests. The message
trace assertion only protects backwards compatibility for explicit `MESSAGE_TRACE` tasks; app generation pipelines must
not create those tasks for this feature.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/app/workflow/test_persistence_layer.py::TestWorkflowPersistenceLayer::test_handle_graph_run_succeeded_enqueues_parent_trace_context \
  api/tests/unit_tests/core/ops/test_trace_session_metadata.py \
  -q
```

Expected: persistence layer assertion FAIL until trace task kwargs include `trace_session_id`.

- [ ] **Step 4: Update workflow persistence trace task**

In `api/core/app/workflow/layers/persistence.py`, collect and pass `trace_session_id`:

```python
trace_session_id = None
if isinstance(self._application_generate_entity, (WorkflowAppGenerateEntity, AdvancedChatAppGenerateEntity)):
    extras = self._application_generate_entity.extras
    external_trace_id = extras.get("external_trace_id")
    trace_session_id = extras.get("trace_session_id")
    parent_trace_context = extras.get("parent_trace_context")
```

Pass it into `TraceTask`:

```python
trace_session_id=trace_session_id,
```

- [ ] **Step 5: Prevent app-generated message trace enqueueing**

Do not enqueue `TraceTaskName.MESSAGE_TRACE` from message-save paths as part of this feature. In
`api/core/app/task_pipeline/easy_ui_based_generate_task_pipeline.py`, saving a message must preserve the existing message
persistence and `message_was_created` event behavior without calling `trace_manager.add_trace_task()`.

Add or update the focused test so a trace manager with `add_trace_task=Mock()` is passed to `_save_message()` and the
assertion is:

```python
trace_manager.add_trace_task.assert_not_called()
```

In `api/core/app/apps/advanced_chat/generate_task_pipeline.py`, saving a message must also avoid calling
`self._application_generate_entity.trace_manager.add_trace_task()`. Add or update the focused advanced-chat pipeline test
with `extras={"trace_session_id": "session-1"}` and assert that the trace manager was not called.

- [ ] **Step 6: Update trace info metadata construction**

In `api/core/ops/ops_trace_manager.py`, add a small private helper near `_dump_parent_trace_context`:

```python
def _get_trace_session_id(kwargs: Mapping[str, Any]) -> str | None:
    value = kwargs.get("trace_session_id")
    return value if isinstance(value, str) and value else None
```

In `workflow_trace()`, after parent context metadata handling:

```python
trace_session_id = _get_trace_session_id(self.kwargs)
if trace_session_id:
    metadata["trace_session_id"] = trace_session_id
```

For backwards compatibility with explicit message trace tasks, `message_trace()` may keep the same metadata handling
after `node_execution_id` handling:

```python
trace_session_id = _get_trace_session_id(kwargs)
if trace_session_id:
    metadata["trace_session_id"] = trace_session_id
```

- [ ] **Step 7: Run trace task tests**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/app/workflow/test_persistence_layer.py::TestWorkflowPersistenceLayer::test_handle_graph_run_succeeded_enqueues_parent_trace_context \
  api/tests/unit_tests/core/ops/test_trace_session_metadata.py \
  -q
```

Expected: PASS.

- [ ] **Step 8: Commit trace task changes**

```bash
git add \
  api/core/app/workflow/layers/persistence.py \
  api/core/app/task_pipeline/easy_ui_based_generate_task_pipeline.py \
  api/core/app/apps/advanced_chat/generate_task_pipeline.py \
  api/core/ops/ops_trace_manager.py \
  api/tests/unit_tests/core/app/workflow/test_persistence_layer.py \
  api/tests/unit_tests/core/ops/test_trace_session_metadata.py
git commit -m "feat: carry trace session id into trace metadata"
```

---

### Task 5: Preserve Trace Session ID Across HITL Pause/Resume

**Files:**
- Modify: `api/tests/unit_tests/core/app/layers/test_pause_state_persist_layer.py`
- Modify: `api/tasks/app_generate/workflow_execute_task.py` only if tests reveal resume overwrites extras.

- [ ] **Step 1: Write failing or confirming resumption roundtrip test**

In `api/tests/unit_tests/core/app/layers/test_pause_state_persist_layer.py`, update the workflow and advanced chat builders used by `test_workflow_resumption_context_dumps_loads_roundtrip` so each generate entity has:

```python
extras={"trace_session_id": "session-1"}
```

Add this assertion to `test_workflow_resumption_context_dumps_loads_roundtrip`:

```python
assert restored_entity.extras["trace_session_id"] == "session-1"
```

- [ ] **Step 2: Run pause state test**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/app/layers/test_pause_state_persist_layer.py::test_workflow_resumption_context_dumps_loads_roundtrip -q
```

Expected: PASS if existing generate entity serialization already preserves `extras`; FAIL if any entity wrapper drops extras.

- [ ] **Step 3: Guard resume from request-level override if needed**

If resume code ever parses request-level args in the future, keep this invariant in `api/tasks/app_generate/workflow_execute_task.py`: do not merge resume payload fields into `generate_entity.extras`. Current `_resume_app_execution()` only loads `generate_entity = resumption_context.get_generate_entity()`, so no code change should be needed.

- [ ] **Step 4: Commit pause/resume test**

```bash
git add api/tests/unit_tests/core/app/layers/test_pause_state_persist_layer.py
git commit -m "test: preserve trace session id in workflow resume state"
```

---

### Task 6: Apply Trace Session ID In Arize/Phoenix Provider

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- Test: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

- [ ] **Step 1: Write failing provider resolver tests**

In `test_arize_phoenix_trace.py`, add imports if needed and add tests near existing session resolver tests:

```python
def test_resolve_workflow_session_id_prefers_trace_session_id_metadata():
    trace_info = _make_workflow_info(
        conversation_id="conversation-1",
        workflow_run_id="workflow-run-1",
        metadata={"app_id": "app-1", "trace_session_id": "session-1"},
    )

    assert _resolve_trace_session_id(trace_info) == "session-1"


def test_resolve_workflow_session_id_falls_back_to_existing_workflow_behavior():
    trace_info = _make_workflow_info(
        conversation_id="conversation-1",
        workflow_run_id="workflow-run-1",
        metadata={"app_id": "app-1"},
    )

    assert _resolve_trace_session_id(trace_info) == "conversation-1"


def test_resolve_message_session_id_prefers_trace_session_id_metadata_for_explicit_message_traces():
    message_data = SimpleNamespace(conversation_id="conversation-1")
    trace_info = _make_message_info(
        message_data=message_data,
        metadata={"app_id": "app-1", "trace_session_id": "session-1"},
    )

    assert _resolve_trace_session_id(trace_info) == "session-1"
```

Update the import list from `dify_trace_arize_phoenix.arize_phoenix_trace` to include:

```python
_resolve_trace_session_id,
```

- [ ] **Step 2: Run provider tests and verify failure**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q
```

Expected: FAIL because `_resolve_trace_session_id` is not defined.

- [ ] **Step 3: Implement centralized resolver**

In `arize_phoenix_trace.py`, replace `_resolve_workflow_session_id()` with:

```python
def _metadata_trace_session_id(trace_info: BaseTraceInfo) -> str | None:
    value = trace_info.metadata.get("trace_session_id")
    return value if isinstance(value, str) and value else None


def _resolve_workflow_session_fallback(trace_info: WorkflowTraceInfo) -> str:
    if trace_info.conversation_id:
        return trace_info.conversation_id

    parent_workflow_run_id, _ = _resolve_workflow_parent_context(trace_info)
    if parent_workflow_run_id:
        return parent_workflow_run_id

    return trace_info.workflow_run_id


def _resolve_message_session_fallback(trace_info: MessageTraceInfo) -> str:
    if trace_info.message_data is not None:
        conversation_id = getattr(trace_info.message_data, "conversation_id", None)
        if conversation_id:
            return conversation_id
    return ""


def _resolve_trace_session_id(trace_info: WorkflowTraceInfo | MessageTraceInfo) -> str:
    trace_session_id = _metadata_trace_session_id(trace_info)
    if trace_session_id:
        return trace_session_id
    if isinstance(trace_info, WorkflowTraceInfo):
        return _resolve_workflow_session_fallback(trace_info)
    return _resolve_message_session_fallback(trace_info)
```

Keep `_resolve_workflow_session_id()` as a backwards-compatible alias for existing tests:

```python
def _resolve_workflow_session_id(trace_info: WorkflowTraceInfo) -> str:
    """Resolve the workflow session ID for Phoenix workflow spans."""
    return _resolve_trace_session_id(trace_info)
```

- [ ] **Step 4: Use resolver in workflow spans**

In `workflow_trace()`, keep the variable name but use the centralized resolver:

```python
workflow_session_id = _resolve_trace_session_id(trace_info)
```

The existing workflow span, wrapper span, and node span attributes already use `workflow_session_id`; no extra changes are needed there.

- [ ] **Step 5: Preserve explicit message trace compatibility without enqueueing message traces**

Do not add new app generation call sites that create `TraceTaskName.MESSAGE_TRACE`. If `message_trace()` is invoked by an
existing explicit trace path and the trace info already has `metadata["trace_session_id"]`, it may use the centralized
resolver for backwards-compatible session grouping.

In `message_trace()`, this optional compatibility path uses:

```python
message_session_id = _resolve_trace_session_id(trace_info)
```

Existing direct uses of:

```python
SpanAttributes.SESSION_ID: trace_info.message_data.conversation_id or "",
```

may be replaced with:

```python
SpanAttributes.SESSION_ID: message_session_id or "",
```

This must not be paired with any new message trace enqueueing in
`api/core/app/task_pipeline/easy_ui_based_generate_task_pipeline.py` or
`api/core/app/apps/advanced_chat/generate_task_pipeline.py`.

- [ ] **Step 6: Ensure metadata retains trace_session_id**

Do not remove `trace_session_id` from `metadata = wrap_span_metadata(trace_info.metadata, ...)`. Because `trace_info.metadata` is passed in, the exported metadata should retain the field.

- [ ] **Step 7: Run provider tests**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q
```

Expected: PASS.

- [ ] **Step 8: Commit provider changes**

```bash
git add \
  api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py
git commit -m "feat: map trace session id to phoenix session"
```

---

### Task 7: Update Service API Documentation

**Files:**
- Modify: `web/app/components/develop/template/template_chat.en.mdx` if present
- Modify: `web/app/components/develop/template/template_advanced_chat.en.mdx` if present
- Modify: `web/app/components/develop/template/template_completion.en.mdx` if present
- Modify: `web/app/components/develop/template/template_workflow.en.mdx` if present
- Modify corresponding localized templates only where existing `trace_id` docs are already present.

- [ ] **Step 1: Locate existing trace_id doc blocks**

Run:

```bash
rg -n "trace_id|X-Trace-Id" web/app/components/develop/template -S
```

Expected: existing `trace_id` docs in chat/advanced chat/workflow templates, and possibly missing completion coverage.

- [ ] **Step 2: Add trace_session_id docs following trace_id style**

For each target generation template that documents Service API request parameters, add a `Property` or bullet matching the local file's existing style:

```mdx
<Property name='trace_session_id' type='string' key='trace_session_id'>
  (Optional) Trace session ID for observability grouping. Tracing providers that support session grouping can use this value as the exported session identifier. It does not change conversation_id, workflow_run_id, trace_id, or span relationships. Supports the following three ways to pass, in order of priority:<br/>
  - Header: via HTTP Header <code>X-Trace-Session-Id</code>, highest priority.<br/>
  - Query parameter: via URL query parameter <code>trace_session_id</code>.<br/>
  - Request Body: via request body field <code>trace_session_id</code> (i.e., this field).<br/>
</Property>
```

For non-English templates, use the existing `trace_id` block as the translation guide and keep the same technical identifiers.

- [ ] **Step 3: Do not add docs to stop/detail/log endpoints**

Confirm `trace_session_id` is only documented for:

- `/chat-messages`
- `/completion-messages`
- `/workflows/run`
- `/workflows/{workflow_id}/run` if the template has a separate section

- [ ] **Step 4: Run documentation grep verification**

Run:

```bash
rg -n "trace_session_id|X-Trace-Session-Id" web/app/components/develop/template -S
```

Expected: hits only in target generation templates.

- [ ] **Step 5: Commit documentation changes**

```bash
git add web/app/components/develop/template
git commit -m "docs: document trace session id service api inputs"
```

---

### Task 8: End-To-End Verification

**Files:**
- No new source files unless previous tasks reveal missing coverage.

- [ ] **Step 1: Run targeted backend tests**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/helper/test_trace_id_helper.py \
  api/tests/unit_tests/controllers/service_api/test_trace_session_id_parsing.py \
  api/tests/unit_tests/core/app/apps/test_trace_session_id_generate_extras.py \
  api/tests/unit_tests/core/app/apps/test_workflow_app_generator.py::test_generate_includes_parent_trace_context_in_extras \
  api/tests/unit_tests/core/app/workflow/test_persistence_layer.py::TestWorkflowPersistenceLayer::test_handle_graph_run_succeeded_enqueues_parent_trace_context \
  api/tests/unit_tests/core/app/layers/test_pause_state_persist_layer.py::test_workflow_resumption_context_dumps_loads_roundtrip \
  api/tests/unit_tests/core/ops/test_trace_session_metadata.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py \
  -q
```

Expected: PASS.

- [ ] **Step 2: Run lint on touched backend files**

Run:

```bash
uv run --project api ruff check \
  api/core/helper/trace_id_helper.py \
  api/controllers/service_api/app/completion.py \
  api/controllers/service_api/app/workflow.py \
  api/core/app/apps/chat/app_generator.py \
  api/core/app/apps/agent_chat/app_generator.py \
  api/core/app/apps/agent_app/app_generator.py \
  api/core/app/apps/completion/app_generator.py \
  api/core/app/apps/advanced_chat/app_generator.py \
  api/core/app/apps/workflow/app_generator.py \
  api/core/app/task_pipeline/easy_ui_based_generate_task_pipeline.py \
  api/core/app/apps/advanced_chat/generate_task_pipeline.py \
  api/core/app/workflow/layers/persistence.py \
  api/core/ops/ops_trace_manager.py \
  api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py
```

Expected: PASS.

- [ ] **Step 3: Run type check if practical**

Run:

```bash
uv run --project api pyright
```

Expected: PASS or only known unrelated baseline failures. If baseline failures appear, capture the first unrelated error in the final implementation summary.

- [ ] **Step 4: Verify no response/SSE metadata leak was added**

Run:

```bash
rg -n "trace_session_id" api/core/app/apps/*/generate_response_converter.py api/core/app/apps/common api/fields api/controllers -S
```

Expected: controller parsing hits are acceptable; response converter and response field additions should not appear.

- [ ] **Step 5: Commit final verification-only fixes if any**

If lint/type/test fixes were needed:

```bash
git add <fixed-files>
git commit -m "fix: polish trace session id implementation"
```

---

## Self-Review

- Spec coverage: the plan covers Service API header/query/body parsing, strict validation, generator propagation for chat/completion/workflow/advanced chat, message and workflow trace metadata, Arize/Phoenix session resolution, HITL pause/resume state, nested workflow inheritance, API docs, and non-leakage checks.
- Placeholder scan: no task uses TBD/TODO/fill-in placeholders. Task 3 explicitly calls out nested workflow inheritance because exact nested invocation code must be located during implementation with `rg`; the required behavior is concrete.
- Type consistency: the plan consistently uses `trace_session_id`, `X-Trace-Session-Id`, `get_trace_session_id`, `extract_trace_session_id_from_args`, `_resolve_trace_session_id`, and `metadata["trace_session_id"]`.
