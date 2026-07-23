# LangSmith Turns and Retry Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make unified Chatflow traces render the real Human query in LangSmith Turns and expose compact workflow-node retry summaries in both LangSmith and Phoenix.

**Architecture:** Keep provider-neutral semantics in `CanonicalTraceBuilder`: message spans carry the resolved user query while workflow spans retain raw inputs, and node spans receive compact retry metadata extracted from persisted process data. The LangSmith adapter performs only the provider-specific message-schema conversion; both adapters continue forwarding canonical metadata through their existing paths.

**Tech Stack:** Python 3.12, Pydantic canonical entities, LangSmith SDK, OpenTelemetry/OpenInference, pytest, Ruff, Mypy.

---

## File map

- Modify `api/core/ops/unified_trace/trace_builder.py`: separate message and workflow inputs, consistently mark message spans, and summarize persisted retries.
- Modify `api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py`: cover realistic Chatflow inputs, fallback behavior, and retry summaries.
- Modify `api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py`: translate canonical message strings to LangSmith's explicit message schema.
- Modify `api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py`: cover message conversion, Mapping pass-through, and retry metadata forwarding.
- Modify `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py`: cover retry metadata serialization through OpenInference.

No production Phoenix adapter change, canonical entity change, legacy provider change, or dependency addition is needed.

### Task 1: Correct canonical message input semantics

**Files:**
- Modify: `api/core/ops/unified_trace/trace_builder.py:148-161,328-339`
- Test: `api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py`

- [ ] **Step 1: Add realistic failing Chatflow tests**

Add these tests after `workflow_info`:

```python
CHATFLOW_INPUTS = {
    "sys.app_id": "19a6d372-b8bc-4ad4-9b83-7e6e7138de31",
    "sys.dialogue_count": 1,
    "sys.files": [],
    "sys.query": "hi",
    "sys.user_id": "ca877a63-4d75-4ba3-a417-3edffe5e545c",
    "sys.workflow_id": "8b81be9e-d7c1-4fa7-b90f-03791fa015ba",
    "sys.workflow_run_id": "4eec02ea-4ed5-47cc-87fd-7c3821dd935d",
}


def test_chatflow_message_uses_query_while_workflow_keeps_complete_inputs():
    builder = CanonicalTraceBuilder(lambda info: [])

    trace = builder.build(
        workflow_info(
            message_id="message-1",
            query="hi",
            workflow_run_inputs=CHATFLOW_INPUTS,
        )
    )

    assert trace is not None
    spans = {span.id: span for span in trace.spans}
    assert spans["message-1"].inputs == "hi"
    assert spans["message-1"].metadata["trace_entity_type"] == "message"
    assert spans["run-1"].inputs == CHATFLOW_INPUTS


def test_chatflow_message_falls_back_to_complete_inputs_for_empty_query():
    builder = CanonicalTraceBuilder(lambda info: [])

    trace = builder.build(
        workflow_info(
            message_id="message-1",
            query="",
            workflow_run_inputs=CHATFLOW_INPUTS,
        )
    )

    assert trace is not None
    assert trace.spans[0].inputs == CHATFLOW_INPUTS


def test_workflow_without_message_keeps_complete_inputs_on_root():
    builder = CanonicalTraceBuilder(lambda info: [])

    trace = builder.build(workflow_info(query="hi", workflow_run_inputs=CHATFLOW_INPUTS))

    assert trace is not None
    assert trace.root_span_id == "run-1"
    assert trace.spans[0].inputs == CHATFLOW_INPUTS
```

Extend `test_message_trace_does_not_load_workflow_executions` with:

```python
    assert trace.spans[0].metadata["trace_entity_type"] == "message"
```

- [ ] **Step 2: Run the tests and verify the semantic regression**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py::test_chatflow_message_uses_query_while_workflow_keeps_complete_inputs \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py::test_chatflow_message_falls_back_to_complete_inputs_for_empty_query \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py::test_workflow_without_message_keeps_complete_inputs_on_root \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py::test_message_trace_does_not_load_workflow_executions -q
```

Expected: the query and standalone message metadata assertions fail; the fallback and plain-workflow assertions pass.

- [ ] **Step 3: Implement the minimal canonical fix**

In `_build_workflow`, change only the root message input:

```python
                inputs=trace_info.query or dict(trace_info.workflow_run_inputs),
```

Keep the child workflow input unchanged:

```python
            inputs=dict(trace_info.workflow_run_inputs),
```

In `_build_message`, add the semantic marker to the existing metadata dictionary:

```python
        metadata = {
            **trace_info.metadata,
            "trace_entity_type": "message",
            "model_provider": getattr(message, "model_provider", None),
            "model_name": getattr(message, "model_id", None),
            "prompt_tokens": trace_info.message_tokens,
            "completion_tokens": trace_info.answer_tokens,
            "total_tokens": trace_info.total_tokens,
        }
```

- [ ] **Step 4: Run the focused builder tests**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py -q
```

Expected: all tests pass.

- [ ] **Step 5: Commit the canonical semantics change**

```bash
git add api/core/ops/unified_trace/trace_builder.py \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py
git commit -m "fix(trace): preserve message semantics in chatflow traces"
```

### Task 2: Emit LangSmith's explicit Human message schema

**Files:**
- Modify: `api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py:7-44,104-122`
- Test: `api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py`

- [ ] **Step 1: Add failing adapter tests for message conversion and Mapping pass-through**

Add after `test_root_trace_id_equals_root_run_id_and_sets_thread_session`:

```python
def test_message_span_uses_explicit_langsmith_human_message_schema(adapter):
    subject, client = adapter
    message = span(
        name="message",
        inputs="hi",
        metadata={"trace_entity_type": "message"},
    )

    subject.emit(trace(message), None, MagicMock())

    assert client.create_run.call_args.kwargs["inputs"] == {
        "messages": [{"role": "user", "content": "hi"}]
    }


def test_mapping_inputs_remain_unchanged_for_message_fallback_and_other_spans(adapter):
    subject, client = adapter
    raw_inputs = {"sys.app_id": "app-1", "sys.files": []}
    message = span(
        name="message",
        inputs=raw_inputs,
        metadata={"trace_entity_type": "message"},
    )

    subject.emit(trace(message), None, MagicMock())

    assert client.create_run.call_args.kwargs["inputs"] == raw_inputs
```

- [ ] **Step 2: Run the two adapter tests and verify the first fails**

Run:

```bash
uv run --project api pytest \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py::test_message_span_uses_explicit_langsmith_human_message_schema \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py::test_mapping_inputs_remain_unchanged_for_message_fallback_and_other_spans -q
```

Expected: the explicit message-schema assertion fails because the current adapter emits `{"input": "hi"}`; Mapping pass-through passes.

- [ ] **Step 3: Add the smallest provider-specific input mapper**

Import `CanonicalSpan` with the existing canonical types:

```python
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
```

Add next to `_langsmith_value`:

```python
def _langsmith_inputs(span: CanonicalSpan) -> dict[str, Any]:
    if span.metadata.get("trace_entity_type") == "message" and isinstance(span.inputs, str):
        return {"messages": [{"role": "user", "content": span.inputs}]}
    return _langsmith_value(span.inputs, "input")
```

Change only the `inputs` argument in `create_run`:

```python
                inputs=_langsmith_inputs(canonical_span),
```

Leave output conversion and every non-message run unchanged.

- [ ] **Step 4: Run the complete unified LangSmith adapter test file**

Run:

```bash
uv run --project api pytest \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py -q
```

Expected: all tests pass.

- [ ] **Step 5: Commit the LangSmith translation**

```bash
git add api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py
git commit -m "fix(trace): map chatflow queries to LangSmith messages"
```

### Task 3: Add compact retry summaries to canonical node metadata

**Files:**
- Modify: `api/core/ops/unified_trace/trace_builder.py:8-28,218-252`
- Test: `api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py`

- [ ] **Step 1: Add failing retry-summary tests**

Add these helpers and tests after `test_workflow_tool_is_marked_as_nested_workflow_parent`:

```python
def retry_attempt(retry_index: object, **overrides):
    values = {
        "retry_index": retry_index,
        "inputs": {"attempt": retry_index},
        "process_data": {"request": f"attempt-{retry_index}"},
        "outputs": {"status_code": 500},
        "error": f"attempt {retry_index} failed",
        "elapsed_time": float(retry_index) if isinstance(retry_index, int) else 0.0,
        "execution_metadata": {"internal": True},
        "created_at": 1_700_000_000,
        "finished_at": 1_700_000_001,
    }
    values.update(overrides)
    return values


def test_node_metadata_contains_compact_retry_summary_and_skips_malformed_entries():
    history = [
        retry_attempt(1),
        "malformed",
        retry_attempt(True),
        retry_attempt(2, error="attempt 2 timed out", elapsed_time=2.5),
        retry_attempt(3),
    ]
    builder = CanonicalTraceBuilder(
        lambda info: [node_execution(process_data={"__dify_retry_history": history})]
    )

    trace = builder.build(workflow_info())

    assert trace is not None
    metadata = trace.spans[-1].metadata
    assert metadata["retry_count"] == 3
    assert metadata["retry_attempts"] == [
        {
            "retry_index": 1,
            "error": "attempt 1 failed",
            "elapsed_time": 1.0,
            "created_at": 1_700_000_000,
            "finished_at": 1_700_000_001,
        },
        {
            "retry_index": 2,
            "error": "attempt 2 timed out",
            "elapsed_time": 2.5,
            "created_at": 1_700_000_000,
            "finished_at": 1_700_000_001,
        },
        {
            "retry_index": 3,
            "error": "attempt 3 failed",
            "elapsed_time": 3.0,
            "created_at": 1_700_000_000,
            "finished_at": 1_700_000_001,
        },
    ]
    assert all("inputs" not in attempt for attempt in metadata["retry_attempts"])
    assert all("process_data" not in attempt for attempt in metadata["retry_attempts"])
    assert all("outputs" not in attempt for attempt in metadata["retry_attempts"])
    assert all("execution_metadata" not in attempt for attempt in metadata["retry_attempts"])


def test_node_without_retry_history_has_no_retry_metadata():
    builder = CanonicalTraceBuilder(lambda info: [node_execution()])

    trace = builder.build(workflow_info())

    assert trace is not None
    assert "retry_count" not in trace.spans[-1].metadata
    assert "retry_attempts" not in trace.spans[-1].metadata
```

- [ ] **Step 2: Run the retry tests and verify the summary test fails**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py::test_node_metadata_contains_compact_retry_summary_and_skips_malformed_entries \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py::test_node_without_retry_history_has_no_retry_metadata -q
```

Expected: the summary test fails with missing `retry_count`; the no-history test passes.

- [ ] **Step 3: Implement a compact best-effort retry summarizer**

Reuse the persistence key instead of duplicating its string value:

```python
from core.app.workflow.retry_history import RETRY_HISTORY_PROCESS_DATA_KEY
```

Add near `_NODE_KIND`:

```python
_RETRY_SUMMARY_FIELDS = ("retry_index", "error", "elapsed_time", "created_at", "finished_at")


def _retry_metadata(process_data: Mapping[str, Any]) -> dict[str, Any]:
    raw_history = process_data.get(RETRY_HISTORY_PROCESS_DATA_KEY)
    if not isinstance(raw_history, list):
        return {}

    attempts: list[dict[str, Any]] = []
    for raw_attempt in raw_history:
        if not isinstance(raw_attempt, Mapping):
            continue
        retry_index = raw_attempt.get("retry_index")
        if isinstance(retry_index, bool) or not isinstance(retry_index, int) or retry_index <= 0:
            continue
        attempts.append({field: raw_attempt.get(field) for field in _RETRY_SUMMARY_FIELDS})

    return {"retry_count": len(attempts), "retry_attempts": attempts} if attempts else {}
```

After existing node metadata and token usage enrichment, merge the summary:

```python
            metadata.update(_retry_metadata(process_data))
```

- [ ] **Step 4: Run the complete builder test file**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py -q
```

Expected: all tests pass.

- [ ] **Step 5: Commit the canonical retry metadata**

```bash
git add api/core/ops/unified_trace/trace_builder.py \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py
git commit -m "feat(trace): export workflow retry summaries"
```

### Task 4: Lock provider metadata forwarding with contract tests

**Files:**
- Test: `api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py`
- Test: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py`

- [ ] **Step 1: Add a LangSmith metadata-forwarding contract test**

Add to the LangSmith test file:

```python
def test_retry_metadata_is_forwarded_to_langsmith(adapter):
    subject, client = adapter
    retry_metadata = {
        "retry_count": 1,
        "retry_attempts": [
            {
                "retry_index": 1,
                "error": "HTTP 500",
                "elapsed_time": 1.2,
                "created_at": 1_700_000_000,
                "finished_at": 1_700_000_001,
            }
        ],
    }
    node = span(metadata=retry_metadata)

    subject.emit(trace(node), None, MagicMock())

    assert client.create_run.call_args.kwargs["extra"]["metadata"] == {
        **retry_metadata,
        "session_id": "session-1",
        "external_trace_id": "customer-trace",
    }
```

- [ ] **Step 2: Add a Phoenix metadata-serialization contract test**

Add `import json` at the top of the Phoenix test file, then add:

```python
def test_retry_metadata_is_serialized_for_phoenix(adapter):
    subject, tracer, _ = adapter
    retry_metadata = {
        "retry_count": 1,
        "retry_attempts": [
            {
                "retry_index": 1,
                "error": "HTTP 500",
                "elapsed_time": 1.2,
                "created_at": 1_700_000_000,
                "finished_at": 1_700_000_001,
            }
        ],
    }

    subject.emit(trace(span(metadata=retry_metadata)), None, MagicMock())

    attributes = tracer.start_span.call_args.kwargs["attributes"]
    assert json.loads(attributes[SpanAttributes.METADATA]) == retry_metadata
```

- [ ] **Step 3: Run both provider test files**

Run:

```bash
uv run --project api pytest \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py -q
```

Expected: all tests pass without production adapter changes.

- [ ] **Step 4: Commit the provider contracts**

```bash
git add \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py
git commit -m "test(trace): verify retry metadata provider forwarding"
```

### Task 5: Final verification

**Files:**
- Verify only; no planned source changes.

- [ ] **Step 1: Run all affected unit tests**

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/ops/unified_trace \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py -q
```

Expected: all tests pass.

- [ ] **Step 2: Run Ruff formatting and lint checks**

```bash
uv run --project api ruff format --check \
  api/core/ops/unified_trace/trace_builder.py \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py \
  api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py
uv run --project api ruff check \
  api/core/ops/unified_trace/trace_builder.py \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py \
  api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py
```

Expected: both commands exit successfully with no findings.

- [ ] **Step 3: Run targeted Mypy checks**

```bash
uv run --project api mypy \
  api/core/ops/unified_trace/trace_builder.py \
  api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py \
  api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/unified_trace.py
```

Expected: `Success: no issues found`.

- [ ] **Step 4: Confirm only the intentional local Squid scaffold remains uncommitted**

```bash
git status --short
git log -6 --oneline
```

Expected: source and test changes are committed; `docker/ssrf_proxy/squid.conf.template` remains the only local setup modification and is not included in feature commits.
