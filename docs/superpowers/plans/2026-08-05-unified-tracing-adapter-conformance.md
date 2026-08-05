# Unified Tracing Adapter Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining unified tracing review concerns by validating canonical fragments, preserving Human Wait kinds and logical links in every adapter, and documenting the revised v1 conformance boundary.

**Architecture:** `CanonicalTrace` rejects malformed in-process fragments before provider translation. Phoenix and LangSmith remain independent adapters, but both preserve the canonical kind and logical links through reserved metadata and map Human Wait to their generic chain type. The ADR/spec records the provider-specific behavior and keeps nested Loop/Iteration outside the v1 producer contract without adding runtime capability negotiation.

**Tech Stack:** Python 3.12, Pydantic v2, pytest, OpenTelemetry/OpenInference, LangSmith, Markdown ADR/specification.

---

## File map

- `api/core/ops/unified_trace/entities.py`: validate canonical fragment structure at the in-process boundary.
- `api/tests/unit_tests/core/ops/unified_trace/test_entities.py`: exercise every structural validation rule.
- `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/unified_trace.py`: map Human Wait and preserve reserved canonical metadata.
- `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py`: Phoenix behavior-level conformance checks.
- `api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py`: map Human Wait and preserve reserved canonical metadata.
- `api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py`: LangSmith behavior-level conformance checks.
- `docs/architecture/adr/unified-tracing/0001-unified-tracing-runtime.md`: mark the materially updated decision `Revised` and record the producer boundary.
- `docs/architecture/adr/unified-tracing/0001-unified-tracing-runtime-spec.md`: define kind/link preservation and the adapter conformance matrix.

### Task 1: Validate canonical fragments

**Files:**
- Modify: `api/core/ops/unified_trace/entities.py:3-58`
- Test: `api/tests/unit_tests/core/ops/unified_trace/test_entities.py`
- Test: `api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py`

- [ ] **Step 1: Write failing structural validation tests**

Add a local span factory and parameterized invalid-fragment tests to `test_entities.py`. Each case must assert `ValidationError` for exactly one violated invariant:

```python
def span(span_id: str, parent_id: str | None = None) -> CanonicalSpan:
    return CanonicalSpan(
        id=span_id,
        parent_id=parent_id,
        name=span_id,
        kind=CanonicalSpanKind.CHAIN,
        start_time=datetime(2025, 1, 1),
        end_time=None,
        status=CanonicalSpanStatus.OK,
    )


@pytest.mark.parametrize(
    ("root_span_id", "spans"),
    [
        ("missing", (span("root"),)),
        ("root", (span("root"), span("root", "root"))),
        ("root", (span("root", "outside"),)),
        ("root", (span("root"), span("child"))),
        ("root", (span("root"), span("child", "later"), span("later", "root"))),
    ],
)
def test_canonical_trace_rejects_invalid_fragment(root_span_id, spans) -> None:
    with pytest.raises(ValidationError):
        CanonicalTrace(
            trace_id="trace-1",
            session_id="session-1",
            root_span_id=root_span_id,
            spans=spans,
        )
```

Add one test that supplies both external-parent modes:

```python
def test_canonical_trace_rejects_conflicting_external_parent_modes() -> None:
    with pytest.raises(ValidationError):
        CanonicalTrace(
            trace_id="trace-1",
            session_id="session-1",
            root_span_id="root",
            spans=(span("root"),),
            external_parent=ParentTraceContext(
                parent_workflow_run_id="outer-run",
                parent_node_execution_id="outer-node",
            ),
            required_parent_context_id="message-1",
        )
```

- [ ] **Step 2: Run the tests and verify malformed fragments are currently accepted**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace/test_entities.py -q
```

Expected: the new invalid-fragment cases fail because `CanonicalTrace` currently validates field types only.

- [ ] **Step 3: Add one after-model validator**

Import `Self` and `model_validator`, then add one validator to `CanonicalTrace`:

```python
@model_validator(mode="after")
def validate_fragment(self) -> Self:
    if self.external_parent is not None and self.required_parent_context_id is not None:
        raise ValueError("canonical trace cannot require two external parent modes")

    seen: set[str] = set()
    root_seen = False
    for span in self.spans:
        if span.id in seen:
            raise ValueError(f"duplicate canonical span id: {span.id}")
        if span.id == self.root_span_id:
            root_seen = True
            if span.parent_id is not None:
                raise ValueError("canonical trace root cannot have a local parent")
        elif span.parent_id is None or span.parent_id not in seen:
            raise ValueError(f"canonical span parent must appear first: {span.id}")
        seen.add(span.id)

    if not root_seen:
        raise ValueError("canonical trace root is missing")
    return self
```

This intentionally rejects multiple local roots and makes parent-first ordering sufficient to exclude local cycles.

- [ ] **Step 4: Move the obsolete invalid-root adapter test to the canonical boundary**

Remove `test_root_does_not_infer_external_parent_from_local_parent_id` from the LangSmith adapter suite. Its malformed fixture must now fail during `CanonicalTrace` construction, while the existing restored-parent tests continue to prove that only Core-supplied `ParentResolution` creates an external provider parent.

- [ ] **Step 5: Run Core and builder regressions**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/ops/unified_trace/test_entities.py \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py \
  api/tests/unit_tests/core/ops/unified_trace/test_provider.py \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py -q
```

Expected: all tests pass and every production builder output satisfies the validator.

- [ ] **Step 6: Commit canonical validation**

```bash
git add \
  api/core/ops/unified_trace/entities.py \
  api/tests/unit_tests/core/ops/unified_trace/test_entities.py \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py
git commit -m "fix(trace): validate canonical fragments"
```

### Task 2: Preserve Human Wait kinds and logical links

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/unified_trace.py:33-39,102-127`
- Test: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py`
- Modify: `api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py:31-39,101-140`
- Test: `api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py`

- [ ] **Step 1: Write failing Phoenix conformance tests**

Parameterize a behavior test over all canonical kinds and expected OpenInference values, including Human Wait:

```python
@pytest.mark.parametrize("kind", list(CanonicalSpanKind))
def test_emit_maps_every_canonical_kind(adapter, kind):
    expected = {
        CanonicalSpanKind.CHAIN: "CHAIN",
        CanonicalSpanKind.LLM: "LLM",
        CanonicalSpanKind.RETRIEVER: "RETRIEVER",
        CanonicalSpanKind.TOOL: "TOOL",
        CanonicalSpanKind.AGENT: "AGENT",
        CanonicalSpanKind.HUMAN_WAIT: "CHAIN",
    }[kind]
    subject, tracer, _ = adapter
    subject.emit(trace(span(kind=kind)), None, MagicMock())
    attributes = tracer.start_span.call_args.kwargs["attributes"]
    assert attributes[SpanAttributes.OPENINFERENCE_SPAN_KIND] == expected
    metadata = json.loads(attributes[SpanAttributes.METADATA])
    assert metadata["dify.span.kind"] == kind.value
```

Add a logical-link test using `metadata={"dify.span.kind": "forged", "dify.span.links": ["forged"]}` and `links=("message-a",)`. Assert the serialized metadata contains canonical values `human_wait` and `["message-a"]`.

- [ ] **Step 2: Write failing LangSmith conformance tests**

Parameterize the equivalent behavior test over expected run types:

```python
@pytest.mark.parametrize("kind", list(CanonicalSpanKind))
def test_emit_maps_every_canonical_kind(adapter, kind):
    expected = {
        CanonicalSpanKind.CHAIN: "chain",
        CanonicalSpanKind.LLM: "llm",
        CanonicalSpanKind.RETRIEVER: "retriever",
        CanonicalSpanKind.TOOL: "tool",
        CanonicalSpanKind.AGENT: "chain",
        CanonicalSpanKind.HUMAN_WAIT: "chain",
    }[kind]
    subject, client = adapter
    subject.emit(trace(span(kind=kind)), None, MagicMock())
    run = client.create_run.call_args.kwargs
    assert run["run_type"] == expected
    assert run["extra"]["metadata"]["dify.span.kind"] == kind.value
```

Add the same conflicting-metadata logical-link test and assert the outgoing LangSmith metadata contains canonical values.

- [ ] **Step 3: Run the new tests and verify Human Wait fails and links disappear**

Run:

```bash
uv run --project api pytest \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py -q
```

Expected: Human Wait raises `KeyError`; canonical kind and logical-link metadata assertions fail.

- [ ] **Step 4: Add the minimal provider mappings and reserved metadata**

Add `CanonicalSpanKind.HUMAN_WAIT` to each existing mapping with the provider's chain value. In each adapter, copy caller metadata and then overwrite reserved canonical keys:

```python
metadata = dict(canonical_span.metadata)
metadata["dify.span.kind"] = canonical_span.kind.value
if canonical_span.links:
    metadata["dify.span.links"] = list(canonical_span.links)
```

Do not synthesize an OpenTelemetry `Link`; the canonical value does not contain a real provider `SpanContext`.

- [ ] **Step 5: Run both provider suites**

Run the Task 2 Step 3 command again.

Expected: all provider tests pass, including existing acceptance, retry, and parent-publication assertions.

- [ ] **Step 6: Commit adapter conformance fixes**

```bash
git add \
  api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/unified_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py \
  api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py
git commit -m "fix(trace): preserve canonical adapter semantics"
```

### Task 3: Revise the runtime contract documentation

**Files:**
- Modify: `docs/architecture/adr/unified-tracing/0001-unified-tracing-runtime.md`
- Modify: `docs/architecture/adr/unified-tracing/0001-unified-tracing-runtime-spec.md`

- [ ] **Step 1: Revise ADR status and producer boundary**

Change the ADR status to `Revised`. Replace wording that merely calls nesting out of scope with an explicit producer contract:

```markdown
Contract v1 accepts only the non-nested Loop and Iteration topology produced by supported Dify product paths. The tracing runtime does not detect, flatten, or warn about nested-container state that the product contract cannot produce. Before any supported producer may emit nested containers, Core topology semantics and conformance tests must be revised; adapters never infer nested containment.
```

- [ ] **Step 2: Add canonical preservation and conformance requirements**

Add normative requirements that:

```markdown
- every registered adapter MUST accept every current `CanonicalSpanKind`;
- adapters MUST preserve the canonical kind as `dify.span.kind`;
- `CanonicalSpan.links` contains logical Dify identifiers and MUST be preserved as `dify.span.links` when non-empty;
- reserved canonical metadata MUST override conflicting caller metadata;
- v1 MUST NOT fabricate provider-native links without provider-resolvable link context.
```

Add the approved Phoenix/LangSmith conformance table covering Human Wait mapping, link representation, provider identity stability, replay, and acceptance.

- [ ] **Step 3: Align the fragment invariant language with runtime validation**

State explicitly that the fragment has exactly one local root, all non-root spans have an earlier local parent, the two trace-level external-parent modes are mutually exclusive, and malformed canonical fragments fail terminally without changing the application result.

- [ ] **Step 4: Check documentation consistency**

Run:

```bash
rg -n 'Status: Proposed|native link|nested|HUMAN_WAIT|dify\.span\.(kind|links)|T[B]D|T[O]DO' \
  docs/architecture/adr/unified-tracing/0001-unified-tracing-runtime.md \
  docs/architecture/adr/unified-tracing/0001-unified-tracing-runtime-spec.md
git diff --check
```

Expected: status is `Revised`; nesting, Human Wait, and metadata rules agree with the implementation; no placeholder or whitespace errors appear.

- [ ] **Step 5: Commit the revised contract**

```bash
git add \
  docs/architecture/adr/unified-tracing/0001-unified-tracing-runtime.md \
  docs/architecture/adr/unified-tracing/0001-unified-tracing-runtime-spec.md
git commit -m "docs(trace): revise adapter conformance contract"
```

### Task 4: Verify the complete change

**Files:**
- Verify all files changed by Tasks 1-3.
- Preserve: `docker/ssrf_proxy/squid.conf.template`.

- [ ] **Step 1: Run Ruff**

```bash
uv run --project api ruff check \
  api/core/ops/unified_trace/entities.py \
  api/tests/unit_tests/core/ops/unified_trace/test_entities.py \
  api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/unified_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py \
  api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py

uv run --project api ruff format --check \
  api/core/ops/unified_trace/entities.py \
  api/tests/unit_tests/core/ops/unified_trace/test_entities.py \
  api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/unified_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py \
  api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py
```

Expected: both commands succeed without changes.

- [ ] **Step 2: Run targeted regression tests**

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/ops/unified_trace/test_entities.py \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py \
  api/tests/unit_tests/core/ops/unified_trace/test_provider.py \
  api/tests/unit_tests/core/ops/unified_trace/test_parent_context.py \
  api/tests/unit_tests/tasks/test_ops_trace_task.py \
  api/tests/unit_tests/tasks/test_human_input_timeout_tasks.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py -q
```

Expected: all targeted tests pass.

- [ ] **Step 3: Verify worktree hygiene**

```bash
git diff --check
git status --short
git log --oneline -8
```

Expected: implementation and documentation changes are committed; the pre-existing `docker/ssrf_proxy/squid.conf.template` modification remains unstaged and untouched.
