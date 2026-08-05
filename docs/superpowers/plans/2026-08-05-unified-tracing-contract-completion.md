# Unified Tracing Contract Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the unified tracing v1 contract with stable standalone identities, explicit Core-owned Message parent resolution, a uniform adapter acceptance contract, and normative documentation.

**Architecture:** Persist one optional canonical operation identifier in the existing trace payload, then build every standalone Message child as a local root with an explicit required parent-context identifier. Core resolves that context before provider emission; adapters consume only the resolved relationship. Existing payloads remain valid, no serialized contract version is added, and all tracing failures remain isolated from application execution.

**Tech Stack:** Python 3.12, Pydantic v2, Celery, pytest, OpenTelemetry/Phoenix, LangSmith, Markdown ADR/specification.

---

## File map

- `api/core/ops/entities/trace_entity.py`: additive persisted `operation_id` field on trace information.
- `api/core/ops/ops_trace_manager.py`: assign the operation identifier exactly once at the durable payload boundary.
- `api/core/ops/unified_trace/trace_builder.py`: reuse the stable identifier and express Message parentage through `required_parent_context_id`.
- `api/core/ops/unified_trace/provider.py`: document the common adapter acceptance and failure contract.
- `api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py`: remove adapter-local inference of an out-of-fragment root parent.
- `api/tests/unit_tests/core/ops/test_ops_trace_manager.py`: persistence compatibility and operation-ID tests.
- `api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py`: canonical fragment invariants and standalone parent tests.
- `api/tests/unit_tests/core/ops/unified_trace/test_provider.py`: Core resolution-before-emission contract tests.
- Provider-specific unified adapter test files: concrete acceptance and parent-consumption tests.
- `docs/architecture/adr/unified-tracing/0001-unified-tracing-runtime.md`: durable architectural decisions.
- `docs/architecture/adr/unified-tracing/0001-unified-tracing-runtime-spec.md`: normative v1 contract and conformance examples.

### Task 1: Persist stable standalone operation identity

**Files:**
- Modify: `api/core/ops/entities/trace_entity.py:14-35`
- Modify: `api/core/ops/ops_trace_manager.py:1570-1610`
- Modify: `api/core/ops/unified_trace/trace_builder.py:425-460`
- Test: `api/tests/unit_tests/core/ops/test_ops_trace_manager.py`
- Test: `api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py`

- [ ] **Step 1: Write failing payload and builder tests**

Add a persistence assertion to `test_trace_queue_persists_with_caller_supplied_file_id`:

```python
path, data = recording_storage.writes[0]
payload = json.loads(data)
operation_id = payload["trace_info"]["operation_id"]
assert path == "ops_trace/app-id/workflow-final-run-1.json"
assert UUID(operation_id)
```

Add two builder tests:

```python
def test_standalone_trace_reuses_persisted_operation_id() -> None:
    builder = CanonicalTraceBuilder(lambda _info: [])
    info = GenerateNameTraceInfo(
        tenant_id="tenant-1",
        conversation_id="conversation-1",
        inputs="title prompt",
        outputs="title",
        operation_id="00000000-0000-0000-0000-000000000099",
        metadata={},
    )

    first = builder.build(info)
    second = builder.build(info)

    assert first is not None
    assert second is not None
    assert first.root_span_id == "00000000-0000-0000-0000-000000000099"
    assert second.root_span_id == first.root_span_id


def test_standalone_trace_accepts_legacy_payload_without_operation_id() -> None:
    info = GenerateNameTraceInfo.model_validate(
        {
            "tenant_id": "tenant-1",
            "conversation_id": "conversation-1",
            "inputs": "title prompt",
            "outputs": "title",
            "metadata": {},
        }
    )

    trace = CanonicalTraceBuilder(lambda _info: []).build(info)

    assert trace is not None
    assert UUID(trace.root_span_id)
```

- [ ] **Step 2: Run the tests and verify the missing field/unstable ID failures**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/ops/test_ops_trace_manager.py::test_trace_queue_persists_with_caller_supplied_file_id \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py::test_standalone_trace_reuses_persisted_operation_id \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py::test_standalone_trace_accepts_legacy_payload_without_operation_id -q
```

Expected: the payload has no `operation_id`, and `GenerateNameTraceInfo` rejects or ignores the supplied identifier.

- [ ] **Step 3: Add the optional field and assign it at persistence**

Add to `BaseTraceInfo`:

```python
operation_id: str | None = None
```

Import `BaseTraceInfo` into `ops_trace_manager.py`, then update `persist_trace_task` immediately after `task.execute()`:

```python
trace_info = task.execute()
if isinstance(trace_info, BaseTraceInfo) and trace_info.operation_id is None:
    trace_info = trace_info.model_copy(update={"operation_id": str(uuid4())})
```

Update `_single_trace`:

```python
operation_id = span_id or trace_info.operation_id or str(uuid4())
```

Do not derive the operation identifier from `file_id`; the two values represent canonical identity and delivery identity respectively.

- [ ] **Step 4: Run focused and serialization regression tests**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/ops/test_ops_trace_manager.py \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py \
  api/tests/unit_tests/tasks/test_ops_trace_task.py -q
```

Expected: all tests pass, including legacy payload reconstruction in `process_trace_tasks`.

- [ ] **Step 5: Commit the stable identity change**

```bash
git add \
  api/core/ops/entities/trace_entity.py \
  api/core/ops/ops_trace_manager.py \
  api/core/ops/unified_trace/trace_builder.py \
  api/tests/unit_tests/core/ops/test_ops_trace_manager.py \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py
git commit -m "fix(trace): persist standalone operation identity"
```

### Task 2: Make standalone Message parentage explicit

**Files:**
- Modify: `api/core/ops/unified_trace/trace_builder.py:425-635`
- Test: `api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py`
- Test: `api/tests/unit_tests/core/ops/unified_trace/test_provider.py`

- [ ] **Step 1: Add failing canonical-fragment tests for all standalone child types**

Extend the imports in `test_trace_builder.py`:

```python
from core.ops.entities.trace_entity import (
    BaseTraceInfo,
    DatasetRetrievalTraceInfo,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    SuggestedQuestionTraceInfo,
    ToolTraceInfo,
    WorkflowTraceInfo,
)
from core.ops.unified_trace.entities import CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
```

Add a parameterized test whose cases construct each standalone child with `message_id="message-1"`:

```python
@pytest.mark.parametrize(
    "info",
    [
        ModerationTraceInfo(
            message_id="message-1",
            message_data=SimpleNamespace(id="message-1"),
            flagged=False,
            action="direct_output",
            preset_response="",
            query="hello",
            metadata={},
        ),
        SuggestedQuestionTraceInfo(
            message_id="message-1",
            message_data=SimpleNamespace(id="message-1"),
            total_tokens=1,
            suggested_question=["next"],
            level="info",
            metadata={},
        ),
        DatasetRetrievalTraceInfo(
            message_id="message-1",
            message_data=SimpleNamespace(id="message-1"),
            documents=[],
            metadata={},
        ),
        ToolTraceInfo(
            message_id="message-1",
            tool_name="search",
            tool_inputs={},
            tool_outputs="done",
            tool_config={},
            time_cost=0.1,
            tool_parameters={},
            metadata={},
        ),
        GenerateNameTraceInfo(
            tenant_id="tenant-1",
            conversation_id="conversation-1",
            message_id="message-1",
            metadata={},
        ),
    ],
)
def test_standalone_message_child_uses_explicit_required_parent(info: BaseTraceInfo) -> None:
    trace = CanonicalTraceBuilder(lambda _info: []).build(info)

    assert trace is not None
    assert trace.spans[0].parent_id is None
    assert trace.required_parent_context_id == "message-1"
```

Update `test_generate_name_uses_message_parent_and_conversation_session` so it expects `trace.spans[0].parent_id is None`.

Add a structural helper and apply it to representative workflow, Message, and standalone traces:

```python
def assert_fragment_is_parent_first(trace: CanonicalTrace) -> None:
    seen: set[str] = set()
    ids = [span.id for span in trace.spans]
    assert len(ids) == len(set(ids))
    assert trace.root_span_id in ids
    for span in trace.spans:
        if span.id == trace.root_span_id:
            assert span.parent_id is None
        elif span.parent_id is not None:
            assert span.parent_id in seen
        seen.add(span.id)
```

- [ ] **Step 2: Run focused tests and verify current out-of-fragment parents fail**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py \
  api/tests/unit_tests/core/ops/unified_trace/test_provider.py -q
```

Expected: Moderation, Suggested Question, Dataset Retrieval, Tool, and Generate Name roots still contain `parent_id="message-1"`; only Generate Name currently sets the required context.

- [ ] **Step 3: Replace `_single_trace` local parent input with explicit parent context**

Change the private helper signature and construction:

```python
def _single_trace(
    self,
    trace_info: BaseTraceInfo,
    *,
    name: str,
    kind: CanonicalSpanKind,
    inputs: Any,
    outputs: Any,
    error: str | None = None,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    parent_context_id: str | None = None,
    span_id: str | None = None,
    session_id: str | None = None,
) -> CanonicalTrace:
    operation_id = span_id or trace_info.operation_id or str(uuid4())
    trace_id = trace_info.resolved_trace_id or parent_context_id or operation_id
    span = CanonicalSpan(
        id=operation_id,
        parent_id=None,
        name=name,
        kind=kind,
        start_time=_started_at(start_time or trace_info.start_time),
        end_time=end_time or trace_info.end_time,
        inputs=inputs,
        outputs=outputs,
        status=_status(error),
        error=error,
        metadata=dict(trace_info.metadata),
    )
    return CanonicalTrace(
        trace_id=trace_id,
        session_id=session_id if session_id is not None else _single_session_id(trace_info),
        root_span_id=operation_id,
        spans=(span,),
        required_parent_context_id=parent_context_id,
    )
```

Change each standalone child call from `parent_id=trace_info.message_id` to:

```python
parent_context_id=trace_info.message_id
```

Remove the separate `required_parent_context_id` argument because the helper now derives it from the single explicit cross-task parent input.

- [ ] **Step 4: Verify Core resolves every required parent before emission**

Keep `test_runtime_resolves_required_message_parent_before_emission` and add the ordering assertion:

```python
events: list[str] = []
coordinator.resolve_required.side_effect = lambda *_args, **_kwargs: (
    events.append("resolve") or ParentResolution.restored(MagicMock())
)
adapter.emit.side_effect = lambda *_args: events.append("emit")

runtime.trace(MagicMock())

assert events == ["resolve", "emit"]
```

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py \
  api/tests/unit_tests/core/ops/unified_trace/test_provider.py \
  api/tests/unit_tests/core/ops/unified_trace/test_parent_context.py \
  api/tests/unit_tests/tasks/test_ops_trace_task.py -q
```

Expected: all tests pass; unavailable context continues to surface as the existing retryable error handled by `process_trace_tasks`.

- [ ] **Step 5: Commit explicit Core parent resolution**

```bash
git add \
  api/core/ops/unified_trace/trace_builder.py \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py \
  api/tests/unit_tests/core/ops/unified_trace/test_provider.py
git commit -m "fix(trace): resolve standalone message parents in core"
```

### Task 3: Codify the adapter contract and remove LangSmith inference

**Files:**
- Modify: `api/core/ops/unified_trace/provider.py:20-35`
- Modify: `api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py:84-116`
- Test: `api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py`
- Test: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py`
- Test: `api/tests/unit_tests/core/ops/unified_trace/test_provider.py`

- [ ] **Step 1: Add a failing LangSmith no-inference test**

```python
def test_root_does_not_infer_external_parent_from_local_parent_id(adapter):
    subject, client = adapter
    invalid_legacy_root = span(parent_id="00000000-0000-0000-0000-000000000099")

    subject.emit(trace(invalid_legacy_root), None, MagicMock())

    run = client.create_run.call_args.kwargs
    assert run["trace_id"] == ROOT_ID
    assert run["parent_run_id"] is None
```

This test isolates the adapter boundary: only a supplied `ParentResolution` may create an external provider parent.

- [ ] **Step 2: Run the LangSmith test and verify the inferred parent failure**

Run:

```bash
uv run --project api pytest \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py::test_root_does_not_infer_external_parent_from_local_parent_id -q
```

Expected: FAIL because LangSmith currently maps the out-of-fragment `parent_id` to `parent_run_id` and `trace_id`.

- [ ] **Step 3: Remove provider-local inference and document `emit` semantics**

Replace the LangSmith no-resolution branch with:

```python
else:
    trace_id = root_provider_id
    external_parent_id = None
    external_parent_order = None
```

Add this docstring to `UnifiedTraceAdapter.emit`:

```python
"""Emit one Core-resolved, parent-first canonical fragment.

Return only after the provider-specific synchronous acceptance step succeeds.
Raise RetryableTraceDispatchError when acceptance is unconfirmed because of a
recoverable provider or transport failure. Raise another exception for a
terminal failure. Publish parent context only after the corresponding provider
parent span has been accepted.
"""
```

Do not add capability flags or a checkpoint interface.

- [ ] **Step 4: Run Core and both provider conformance suites**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/ops/unified_trace/test_provider.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py \
  api/tests/unit_tests/tasks/test_ops_trace_task.py -q
```

Expected: all tests pass. Existing Phoenix tests prove publication follows exporter success; LangSmith tests prove publication follows `create_run`, retryable SDK errors propagate, terminal SDK errors remain terminal, and no adapter-local parent inference remains.

- [ ] **Step 5: Commit the adapter contract**

```bash
git add \
  api/core/ops/unified_trace/provider.py \
  api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py
git commit -m "refactor(trace): enforce unified adapter contract"
```

### Task 4: Publish the normative v1 runtime contract

**Files:**
- Modify: `docs/architecture/adr/unified-tracing/0001-unified-tracing-runtime.md`
- Create: `docs/architecture/adr/unified-tracing/0001-unified-tracing-runtime-spec.md`

- [ ] **Step 1: Update the ADR with the approved durable decisions**

Add concise decision statements without fixing replaceable class names or storage mechanisms:

```markdown
- Contract v1 supports only the non-nested Loop and Iteration topology supported by the Dify product. Nested-container support must extend the canonical contract before release; adapters never infer it.
- Cross-task parentage is resolved by Core and never encoded as a local parent outside the fragment.
- Standalone canonical operation identity is persisted once and remains stable across retries when the payload contains the additive identifier; older payloads retain their compatibility fallback.
- Each delivery attempt resolves the latest tracing configuration. Credentials are not frozen into trace payloads and are not part of destination identity.
- A registered unified adapter supports the complete current contract and returns only after its synchronous provider acceptance boundary.
- `TaskData` retains its backwards-compatible serialized shape and `CanonicalTrace` remains an in-process boundary. Parent-context envelopes remain the versioned serialized coordination boundary.
```

Keep the ADR status `Proposed`.

- [ ] **Step 2: Write the normative specification**

Create `0001-unified-tracing-runtime-spec.md` with these normative sections and requirements:

```markdown
# Unified Tracing Runtime Contract v1

## Conformance language
The terms MUST, MUST NOT, SHOULD, and MAY are normative.

## Fragment invariants
- Core MUST supply unique span identifiers and a present root.
- A local parent MUST identify an earlier span in the same fragment.
- The root MUST NOT carry a local parent.
- Cross-task parentage MUST be represented by Core parent resolution.

## Topology support
- v1 supports non-nested Loop and Iteration containers.
- Adapters MUST NOT infer containment.
- Nested-container product support MUST update this contract and conformance tests before unified tracing claims support.

## Snapshot and identity
- Workflow, Message, execution, wait, Agent-operation, and wrapper identities use their stable Core identifiers.
- A persisted standalone `operation_id`, when present, MUST be reused across delivery attempts.
- Payloads without the additive field MUST remain readable.
- Delivery and provider-native identities are distinct from canonical identity.

## Parent resolution
- Required Message context MUST be resolved before child emission.
- Unavailable required context is retryable; malformed or incompatible stored context is terminal.
- Lookup is non-consuming; duplicate publication is last-write-wins and refreshes retention.
- Missing, expired, and never-published context share the unavailable state.
- Retry exhaustion MUST NOT silently emit a detached root.

## Adapter acceptance and replay
- `emit` returns only after the provider-specific synchronous acceptance boundary.
- Parent context MUST be published only after parent acceptance.
- Recoverable acceptance failures MUST use RetryableTraceDispatchError.
- A retry replays the complete fragment and MAY duplicate provider effects.
- Stable provider identifiers MUST be used when supported, without implying exactly-once delivery.

## Configuration and destination
- Each attempt uses the latest configuration and one selected runtime/destination.
- Destination identity uses provider, normalized endpoint, and project; credentials MUST NOT participate.
- Unified dispatch MUST NOT fall back to legacy after external emission may have begun.

## Trust and versioning
- Parent context is coordination data, never an authorization token.
- Credentials MUST NOT be stored in the envelope.
- Unknown envelope versions fail closed.
- Unified mode MUST be enabled only after every ops_trace worker supports v1.
```

Include five normative examples: supported Loop/Iteration, explicit standalone Message child, child-before-parent retry, whole-fragment replay after partial acceptance, and configuration change between attempts. Include one counterexample showing that a LangSmith adapter must not infer a fragment-external local parent.

- [ ] **Step 3: Self-check the ADR and specification**

Run:

```bash
rg -n 'T[B]D|T[O]DO|PLACE[H]OLDER|Status: Accepted' \
  docs/architecture/adr/unified-tracing/0001-unified-tracing-runtime.md \
  docs/architecture/adr/unified-tracing/0001-unified-tracing-runtime-spec.md
git diff --check
```

Expected: the search prints nothing, ADR status remains `Proposed`, and there are no whitespace errors. Inspect every MUST/MUST NOT and verify a test or explicit operational prerequisite backs it.

- [ ] **Step 4: Commit the normative contract**

```bash
git add \
  docs/architecture/adr/unified-tracing/0001-unified-tracing-runtime.md \
  docs/architecture/adr/unified-tracing/0001-unified-tracing-runtime-spec.md
git commit -m "docs(trace): specify unified runtime contract v1"
```

### Task 5: Verify compatibility and worktree hygiene

**Files:**
- Verify all files changed by Tasks 1-4
- Preserve: `docker/ssrf_proxy/squid.conf.template`

- [ ] **Step 1: Run formatting and lint checks**

```bash
uv run --project api ruff check \
  api/core/ops/entities/trace_entity.py \
  api/core/ops/ops_trace_manager.py \
  api/core/ops/unified_trace/trace_builder.py \
  api/core/ops/unified_trace/provider.py \
  api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py \
  api/tests/unit_tests/core/ops/test_ops_trace_manager.py \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py \
  api/tests/unit_tests/core/ops/unified_trace/test_provider.py \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py

uv run --project api ruff format --check \
  api/core/ops/entities/trace_entity.py \
  api/core/ops/ops_trace_manager.py \
  api/core/ops/unified_trace/trace_builder.py \
  api/core/ops/unified_trace/provider.py \
  api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py
```

Expected: Ruff reports no errors and every file is already formatted.

- [ ] **Step 2: Run the complete targeted regression suite**

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/ops/test_trace_queue_manager.py \
  api/tests/unit_tests/core/ops/test_ops_trace_manager.py \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py \
  api/tests/unit_tests/core/ops/unified_trace/test_provider.py \
  api/tests/unit_tests/core/ops/unified_trace/test_parent_context.py \
  api/tests/unit_tests/tasks/test_ops_trace_task.py \
  api/tests/unit_tests/tasks/test_human_input_timeout_tasks.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py -q
```

Expected: all targeted tests pass. The existing Human Input final-handoff behavior remains unchanged.

- [ ] **Step 3: Verify branch and user-change hygiene**

```bash
git diff --check
git status --short
git log --oneline -8
```

Expected: implementation and documentation changes are committed. The pre-existing `docker/ssrf_proxy/squid.conf.template` modification remains unstaged and untouched.
