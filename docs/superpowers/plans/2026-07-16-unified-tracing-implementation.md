# Unified Tracing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a disabled-by-default unified tracing path that builds provider-independent trace hierarchy once, supports Phoenix and LangSmith adapters, and falls back to legacy providers only when no unified adapter is registered.

**Architecture:** `OpsTraceManager` selects either the untouched legacy registry or a separate unified registry. The unified runtime builds a canonical trace tree in `core.ops.unified_trace`, coordinates every nested-workflow parent through Redis, then hands the tree to a thin provider adapter. Unified dispatch failures never invoke the legacy provider.

**Tech Stack:** Python 3.12, Pydantic v2, SQLAlchemy, Redis, Celery, OpenTelemetry/OpenInference, LangSmith SDK, pytest.

---

## Scope and estimated change size

Estimates include implementation and focused tests. They are planning ranges, not line-count targets; do not pad code to match them.

| File | Action | Responsibility | Estimated delta |
|---|---|---|---:|
| `api/configs/feature/__init__.py` | Modify | Disabled-by-default global switch | +6 |
| `api/.env.example` | Modify | Document API environment switch | +1 |
| `docker/envs/core-services/shared.env.example` | Modify | Document Docker environment switch | +1 |
| `api/core/ops/ops_trace_manager.py` | Modify | Select unified or legacy registry and isolate cache keys | +45 / -10 |
| `api/core/ops/exceptions.py` | Modify | Terminal context validation/scope exceptions | +25 |
| `api/core/ops/unified_trace/__init__.py` | Create | Package boundary | +5 |
| `api/core/ops/unified_trace/entities.py` | Create | Canonical spans, trace tree, provider context envelope | +190 |
| `api/core/ops/unified_trace/hierarchy.py` | Create | Node hierarchy and loop/iteration wrapper reconstruction | +360 |
| `api/core/ops/unified_trace/parent_context.py` | Create | Redis publish/resolve, scope validation, retry decisions | +230 |
| `api/core/ops/unified_trace/provider.py` | Create | Minimal adapter protocol and unified runtime | +120 |
| `api/core/ops/unified_trace/registry.py` | Create | Lazy unified provider registration | +90 |
| `api/core/ops/unified_trace/trace_builder.py` | Create | TraceInfo/repository data to canonical tree | +330 |
| `api/tests/unit_tests/core/ops/test_ops_trace_manager.py` | Modify | Routing and cache-isolation regression tests | +150 |
| `api/tests/unit_tests/core/ops/unified_trace/__init__.py` | Create | Test package | +1 |
| `api/tests/unit_tests/core/ops/unified_trace/test_entities.py` | Create | Canonical model validation tests | +120 |
| `api/tests/unit_tests/core/ops/unified_trace/test_hierarchy.py` | Create | Hierarchy/wrapper/ambiguity tests | +500 |
| `api/tests/unit_tests/core/ops/unified_trace/test_parent_context.py` | Create | Redis and resolution-outcome tests | +380 |
| `api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py` | Create | Canonical workflow/session/error tests | +380 |
| `api/tests/unit_tests/core/ops/unified_trace/test_provider.py` | Create | Runtime ordering and no-fallback tests | +180 |
| `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/unified_trace.py` | Create | Unified Phoenix adapter | +620 |
| `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py` | Create | Phoenix mapping/context contract tests | +600 |
| `api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py` | Create | Unified LangSmith adapter | +470 |
| `api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py` | Create | LangSmith hierarchy/session/context tests | +520 |
| `api/tests/unit_tests/tasks/test_ops_trace_task.py` | Modify | Coordinator retry and exhaustion regression tests | +80 |

**Expected total:** approximately **4,700 added lines and 10 removed lines** across 24 files. Of those, approximately **2,450 lines are production/config code** and **2,250 lines are tests**. A reasonable implementation range is **4,100–5,200 added lines**. The large legacy Phoenix and LangSmith implementation files are intentionally not modified.

## Invariants to preserve throughout implementation

- `OPS_TRACE_UNIFIED_ENABLED=false` selects exactly the existing provider class.
- An enabled but unregistered provider selects exactly the existing provider class.
- A registered unified provider never calls its legacy provider, including after errors.
- Unified and legacy instances cannot share a cache entry.
- Unified Redis keys never overlap `trace:phoenix:parent_span:*`.
- Parent context is published only after the provider parent span/run is accepted.
- A compatible missing parent context is retryable; malformed context is terminal.
- Cross-provider or cross-scope nesting creates a new root with link metadata, not a retry loop.

---

### Task 1: Add the feature switch and dual-registry routing

**Files:**
- Modify: `api/configs/feature/__init__.py:1214-1225`
- Modify: `api/.env.example:99-100`
- Modify: `docker/envs/core-services/shared.env.example:78-79`
- Create: `api/core/ops/unified_trace/__init__.py`
- Create: `api/core/ops/unified_trace/registry.py`
- Modify: `api/core/ops/ops_trace_manager.py:210-340,486-540`
- Modify test: `api/tests/unit_tests/core/ops/test_ops_trace_manager.py:200-370`

- [ ] **Step 1: Write failing configuration and routing tests**

Add tests that patch both registries and the global setting:

```python
@pytest.mark.parametrize(
    ("enabled", "registered", "expected_class"),
    [
        (False, False, LegacyTrace),
        (False, True, LegacyTrace),
        (True, False, LegacyTrace),
        (True, True, UnifiedTrace),
    ],
)
def test_get_ops_trace_instance_routes_by_global_switch_and_registration(
    enabled: bool,
    registered: bool,
    expected_class: type[BaseTraceInstance],
    monkeypatch: pytest.MonkeyPatch,
    mock_db,
):
    monkeypatch.setattr(dify_config, "OPS_TRACE_UNIFIED_ENABLED", enabled)
    monkeypatch.setattr(
        "core.ops.ops_trace_manager.unified_provider_config_map",
        FakeProviderMap({"dummy": UNIFIED_ENTRY} if registered else {}),
    )
    # Configure the existing app/config fakes used by test_get_ops_trace_instance_success.
    instance = OpsTraceManager.get_ops_trace_instance("app-id")
    assert isinstance(instance, expected_class)


def test_unified_and_legacy_instances_use_different_cache_entries(
    monkeypatch: pytest.MonkeyPatch, mock_db
):
    configure_trace_app_and_decrypted_config(monkeypatch, mock_db)
    monkeypatch.setattr(dify_config, "OPS_TRACE_UNIFIED_ENABLED", False)
    legacy = OpsTraceManager.get_ops_trace_instance("app-id")
    monkeypatch.setattr(dify_config, "OPS_TRACE_UNIFIED_ENABLED", True)
    unified = OpsTraceManager.get_ops_trace_instance("app-id")
    assert legacy is not unified
```

Also assert `DifyConfig().OPS_TRACE_UNIFIED_ENABLED is False` in the existing config test location if one exists; otherwise keep this assertion in `test_ops_trace_manager.py`.

- [ ] **Step 2: Run the tests and confirm red**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/ops/test_ops_trace_manager.py -q
```

Expected: failures because the setting and unified registry do not exist.

- [ ] **Step 3: Add the global setting and examples**

Add to `OpsTraceConfig`:

```python
OPS_TRACE_UNIFIED_ENABLED: bool = Field(
    description="Enable unified ops tracing for providers registered in the unified registry.",
    default=False,
)
```

Add `OPS_TRACE_UNIFIED_ENABLED=false` beside the retry settings in both environment example files.

- [ ] **Step 4: Add a lazy unified registry shell**

Use the existing lazy-import pattern, but register no provider until its adapter task lands:

```python
class UnifiedProviderConfigEntry(TypedDict):
    config_class: type[BaseTracingConfig]
    trace_instance: type[BaseTraceInstance]


class UnifiedTraceProviderConfigMap(collections.UserDict[str, UnifiedProviderConfigEntry]):
    def __getitem__(self, key: str) -> UnifiedProviderConfigEntry:
        raise KeyError(f"Unified tracing provider is not registered: {key}")


unified_provider_config_map = UnifiedTraceProviderConfigMap()
```

Export only the map and entry type from `unified_trace/__init__.py`.

- [ ] **Step 5: Implement one selection branch and mode-aware cache key**

Add a private selector in `OpsTraceManager`:

```python
@classmethod
def _get_dispatch_entry(
    cls, tracing_provider: str
) -> tuple[str, TracingProviderConfigEntry | UnifiedProviderConfigEntry]:
    if dify_config.OPS_TRACE_UNIFIED_ENABLED:
        try:
            return "unified", unified_provider_config_map[tracing_provider]
        except KeyError:
            pass
    return "legacy", provider_config_map[tracing_provider]
```

Use the legacy map for encryption/decryption and all setup APIs. Use `_get_dispatch_entry` only in `get_ops_trace_instance`. Build the cache key as:

```python
cache_key = (mode, tracing_provider, json.dumps(decrypt_trace_config, sort_keys=True))
```

Do not catch constructor or dispatch errors and retry through the legacy entry.

- [ ] **Step 6: Run focused tests**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/ops/test_ops_trace_manager.py -q
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add api/configs/feature/__init__.py api/.env.example docker/envs/core-services/shared.env.example \
  api/core/ops/unified_trace api/core/ops/ops_trace_manager.py \
  api/tests/unit_tests/core/ops/test_ops_trace_manager.py
git commit -m "feat(trace): add isolated unified provider routing"
```

---

### Task 2: Define canonical entities and session semantics

**Files:**
- Create: `api/core/ops/unified_trace/entities.py`
- Create: `api/tests/unit_tests/core/ops/unified_trace/__init__.py`
- Create: `api/tests/unit_tests/core/ops/unified_trace/test_entities.py`
- Create: `api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py`
- Create: `api/core/ops/unified_trace/trace_builder.py`

- [ ] **Step 1: Write failing canonical entity tests**

Cover immutable span IDs, explicit parent IDs, provider-neutral status, session priority, and metadata-copy behavior:

```python
def test_custom_session_id_wins_over_conversation_id():
    info = make_workflow_trace_info(
        conversation_id="conversation-1",
        metadata={"trace_session_id": "customer-session"},
    )
    assert resolve_session_id(info) == "customer-session"


def test_nested_workflow_session_falls_back_to_parent_workflow():
    info = make_workflow_trace_info(
        conversation_id=None,
        workflow_run_id="child-run",
        metadata={
            "parent_trace_context": {
                "parent_workflow_run_id": "parent-run",
                "parent_node_execution_id": "parent-node-execution",
            }
        },
    )
    assert resolve_session_id(info) == "parent-run"
```

- [ ] **Step 2: Run and confirm red**

```bash
uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace/test_entities.py \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py -q
```

Expected: import failures for canonical entities and builder.

- [ ] **Step 3: Define the minimal canonical types**

Use Pydantic models with `extra="forbid"` and no provider SDK types:

```python
class CanonicalSpanKind(StrEnum):
    CHAIN = "chain"
    LLM = "llm"
    RETRIEVER = "retriever"
    TOOL = "tool"
    AGENT = "agent"


class CanonicalSpanStatus(StrEnum):
    OK = "ok"
    ERROR = "error"


class CanonicalSpan(BaseModel):
    id: str
    parent_id: str | None
    name: str
    kind: CanonicalSpanKind
    start_time: datetime
    end_time: datetime | None
    inputs: Any = None
    outputs: Any = None
    status: CanonicalSpanStatus
    error: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    synthetic: bool = False

    model_config = ConfigDict(extra="forbid", frozen=True)


class CanonicalTrace(BaseModel):
    trace_id: str
    session_id: str
    root_span_id: str
    spans: tuple[CanonicalSpan, ...]
    external_parent: ParentTraceContext | None = None

    model_config = ConfigDict(extra="forbid", frozen=True)
```

Keep provider transport context out of `CanonicalTrace`; it belongs to the coordinator envelope in Task 4.

- [ ] **Step 4: Implement session resolution only**

```python
def resolve_session_id(trace_info: WorkflowTraceInfo | MessageTraceInfo) -> str:
    custom = trace_info.metadata.get("trace_session_id")
    if isinstance(custom, str) and custom:
        return custom
    if isinstance(trace_info, WorkflowTraceInfo):
        if trace_info.conversation_id:
            return trace_info.conversation_id
        parent_workflow_run_id, _ = trace_info.resolved_parent_context
        return parent_workflow_run_id or trace_info.workflow_run_id
    if trace_info.message_data is None:
        return ""
    conversation_id = getattr(trace_info.message_data, "conversation_id", None)
    return conversation_id if isinstance(conversation_id, str) else ""
```

Do not mutate `trace_info.metadata` while building canonical values.

- [ ] **Step 5: Run focused tests and commit**

```bash
uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace/test_entities.py \
  api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py -q
git add api/core/ops/unified_trace api/tests/unit_tests/core/ops/unified_trace
git commit -m "feat(trace): define canonical trace entities"
```

Expected: all selected tests pass.

---

### Task 3: Extract deterministic workflow hierarchy reconstruction

**Files:**
- Create: `api/core/ops/unified_trace/hierarchy.py`
- Create: `api/tests/unit_tests/core/ops/unified_trace/test_hierarchy.py`

- [ ] **Step 1: Port behavior tests before implementation**

Translate the existing Phoenix hierarchy tests into provider-neutral assertions. Include:

```python
def test_predecessor_becomes_parent():
    start = execution(id="exec-start", node_id="start", predecessor_node_id=None)
    llm = execution(id="exec-llm", node_id="llm", predecessor_node_id="start")
    result = build_workflow_hierarchy([llm, start])
    assert result.parent_by_execution_id == {"exec-llm": "exec-start"}


def test_repeated_graph_node_id_is_not_guessed_as_parent():
    first = execution(id="exec-a1", node_id="a")
    second = execution(id="exec-a2", node_id="a")
    child = execution(id="exec-b", node_id="b", predecessor_node_id="a")
    assert "exec-b" not in build_workflow_hierarchy([first, second, child]).parent_by_execution_id


def test_iteration_child_is_parented_to_iteration_wrapper():
    container = execution(id="iteration-exec", node_id="iteration", node_type="iteration")
    child = execution(id="child-exec", node_id="child", iteration_id="iteration", iteration_index=0)
    hierarchy = build_workflow_hierarchy([container, child])
    assert hierarchy.wrapper_by_child_execution_id["child-exec"].parent_execution_id == "iteration-exec"


def test_loop_child_is_parented_to_loop_wrapper():
    container = execution(id="loop-exec", node_id="loop", node_type="loop")
    child = execution(id="child-exec", node_id="child", loop_id="loop", loop_index=2)
    wrapper = build_workflow_hierarchy([container, child]).wrapper_by_child_execution_id["child-exec"]
    assert wrapper.key.kind == "loop"
    assert wrapper.key.index == "2"


def test_wrapper_time_covers_all_children():
    first = execution(id="a", iteration_id="container", iteration_index=0, created_at=dt(1), elapsed_time=2)
    second = execution(id="b", iteration_id="container", iteration_index=0, created_at=dt(2), elapsed_time=4)
    container = execution(id="container-exec", node_id="container", node_type="iteration")
    wrapper = build_workflow_hierarchy([container, first, second]).wrappers[0]
    assert wrapper.start_time == dt(1)
    assert wrapper.end_time == dt(6)


def test_wrapper_error_is_true_when_any_child_failed():
    container = execution(id="container-exec", node_id="container", node_type="iteration")
    child = execution(id="child", iteration_id="container", iteration_index=0, status="failed")
    assert build_workflow_hierarchy([container, child]).wrappers[0].has_error is True


def test_cycles_fall_back_to_workflow_root_deterministically():
    a = execution(id="a-exec", node_id="a", predecessor_node_id="b")
    b = execution(id="b-exec", node_id="b", predecessor_node_id="a")
    result = build_workflow_hierarchy([a, b])
    assert not has_parent_cycle(result.parent_by_execution_id)
```

Tests must pass executions in different repository orders to prove order independence.

- [ ] **Step 2: Run and confirm red**

```bash
uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace/test_hierarchy.py -q
```

Expected: import failure for `hierarchy.py`.

- [ ] **Step 3: Implement pure hierarchy functions**

Define focused immutable results:

```python
@dataclass(frozen=True)
class WrapperKey:
    kind: Literal["iteration", "loop"]
    container_execution_id: str
    index: str


@dataclass(frozen=True)
class WrapperSpec:
    id: str
    key: WrapperKey
    parent_execution_id: str
    child_execution_ids: frozenset[str]
    start_time: datetime
    end_time: datetime
    has_error: bool


@dataclass(frozen=True)
class WorkflowHierarchy:
    parent_by_execution_id: Mapping[str, str]
    wrapper_by_child_execution_id: Mapping[str, WrapperSpec]
    wrappers: tuple[WrapperSpec, ...]
```

Port only provider-neutral Phoenix logic:

- stable execution ID selection;
- unique graph-node-ID indexing with ambiguous IDs removed;
- predecessor parent index;
- structured parent lookup from execution attributes/metadata;
- normalized non-negative wrapper indexes;
- deterministic wrapper IDs derived from container execution ID, kind, and index;
- cycle detection and root fallback.

Do not import OpenTelemetry, Redis, LangSmith, database sessions, or provider configuration.

- [ ] **Step 4: Run hierarchy tests**

```bash
uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace/test_hierarchy.py -q
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/core/ops/unified_trace/hierarchy.py \
  api/tests/unit_tests/core/ops/unified_trace/test_hierarchy.py
git commit -m "feat(trace): centralize workflow hierarchy reconstruction"
```

---

### Task 4: Add the versioned Redis parent-context coordinator

**Files:**
- Modify: `api/core/ops/exceptions.py`
- Create: `api/core/ops/unified_trace/parent_context.py`
- Create: `api/tests/unit_tests/core/ops/unified_trace/test_parent_context.py`

- [ ] **Step 1: Write failing envelope and coordinator tests**

Cover publish, compatible resolve, missing retry, corrupt terminal failure, scope mismatch root fallback, parent-not-unified root fallback, and Redis failure retry:

```python
def test_missing_compatible_context_is_retryable(coordinator):
    with pytest.raises(PendingTraceParentContextError):
        coordinator.resolve(
            parent=ParentTraceContext(
                parent_workflow_run_id="outer-run",
                parent_node_execution_id="outer-tool",
            ),
            expected_provider="langsmith",
            expected_scope="scope-a",
            parent_destination=CompatibleUnifiedDestination("langsmith", "scope-a"),
        )


def test_scope_mismatch_returns_link_instead_of_retry(coordinator):
    result = coordinator.resolve(
        parent=parent_context(),
        expected_provider="langsmith",
        expected_scope="scope-b",
        parent_destination=CompatibleUnifiedDestination("langsmith", "scope-a"),
    )
    assert result == ParentResolution.linked_root(parent_context())


def test_malformed_payload_is_terminal(coordinator, redis):
    redis.get.return_value = b'{"version": 1}'
    with pytest.raises(InvalidTraceParentContextError):
        coordinator.resolve(
            parent=parent_context(),
            expected_provider="langsmith",
            expected_scope="scope-a",
            parent_destination=CompatibleUnifiedDestination("langsmith", "scope-a"),
        )
```

- [ ] **Step 2: Run and confirm red**

```bash
uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace/test_parent_context.py -q
```

Expected: missing coordinator models.

- [ ] **Step 3: Add terminal exception types**

```python
class InvalidTraceParentContextError(RuntimeError):
    """Stored unified parent context cannot be safely restored."""


class TraceParentContextPublishError(RetryableTraceDispatchError):
    """Unified parent context could not be persisted after provider emission."""
```

Keep `PendingTraceParentContextError` as the missing-compatible-parent signal used by Celery.

- [ ] **Step 4: Implement envelope and outcomes**

```python
class ProviderParentContext(BaseModel):
    version: Literal[1] = 1
    provider: str
    scope: str
    trace_id: str
    parent_id: str
    provider_context: dict[str, str]

    model_config = ConfigDict(extra="forbid")


class ParentResolutionKind(StrEnum):
    RESTORED = "restored"
    LINKED_ROOT = "linked_root"


@dataclass(frozen=True)
class ParentResolution:
    kind: ParentResolutionKind
    context: ProviderParentContext | None
    linked_parent: ParentTraceContext | None
```

Implement `ParentContextCoordinator` with constructor-injected Redis and parent-destination resolver. Use `setex`, a 300-second constant, and key `trace:unified:parent:{node_execution_id}`. Parse with Pydantic and reject unknown versions/extra fields.

The parent-destination resolver queries the parent workflow/app configuration before deciding whether absence means retry or linked root. Keep that query behind a callable so unit tests do not require a database.

- [ ] **Step 5: Run tests and existing task retry tests**

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/ops/unified_trace/test_parent_context.py \
  api/tests/unit_tests/tasks/test_ops_trace_task.py -q
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add api/core/ops/exceptions.py api/core/ops/unified_trace/parent_context.py \
  api/tests/unit_tests/core/ops/unified_trace/test_parent_context.py
git commit -m "feat(trace): coordinate unified parent contexts"
```

---

### Task 5: Build canonical traces and the unified runtime

**Files:**
- Modify: `api/core/ops/unified_trace/trace_builder.py`
- Create: `api/core/ops/unified_trace/provider.py`
- Modify: `api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py`
- Create: `api/tests/unit_tests/core/ops/unified_trace/test_provider.py`

- [ ] **Step 1: Write failing builder behavior tests**

Use fake workflow executions to assert the complete canonical tree:

```python
def test_build_workflow_trace_uses_hierarchy_and_wrappers(builder):
    trace = builder.build(make_workflow_trace_info(), executions=workflow_executions())
    assert parent_map(trace) == {
        "workflow-run": "message-run",
        "start-exec": "workflow-run",
        "iteration-exec": "start-exec",
        "iteration:iteration-exec:0": "iteration-exec",
        "llm-exec": "iteration:iteration-exec:0",
    }


def test_failed_node_preserves_error_and_error_status(builder):
    trace = builder.build(make_workflow_trace_info(), executions=[execution(status="failed", error="boom")])
    node = trace.spans[-1]
    assert node.status is CanonicalSpanStatus.ERROR
    assert node.error == "boom"


def test_handled_exception_preserves_error_status(builder):
    trace = builder.build(make_workflow_trace_info(), executions=[execution(status="exception", error="handled")])
    assert trace.spans[-1].status is CanonicalSpanStatus.ERROR


def test_llm_span_contains_prompts_model_and_tokens(builder):
    trace = builder.build(make_workflow_trace_info(), executions=[llm_execution()])
    llm = trace.spans[-1]
    assert llm.kind is CanonicalSpanKind.LLM
    assert llm.metadata["model_name"] == "gpt-4"
    assert llm.metadata["prompt_tokens"] == 10


def test_non_workflow_trace_builds_without_repository_query(builder, execution_loader):
    trace = builder.build(make_message_trace_info())
    assert trace is not None
    execution_loader.load.assert_not_called()


def test_builder_does_not_mutate_trace_info_metadata(builder):
    info = make_workflow_trace_info(metadata={"app_id": "app-1"})
    before = deepcopy(info.metadata)
    builder.build(info, executions=[])
    assert info.metadata == before
```

Include Message, Moderation, Suggested Question, Dataset Retrieval, Tool, and Generate Name trace inputs so enabling unified mode does not drop existing trace entity types.

- [ ] **Step 2: Run and confirm red**

```bash
uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py -q
```

Expected: failures for unimplemented build paths.

- [ ] **Step 3: Implement `CanonicalTraceBuilder`**

Constructor-inject the workflow execution loader:

```python
class WorkflowExecutionLoader(Protocol):
    def load(self, trace_info: WorkflowTraceInfo) -> Sequence[WorkflowNodeExecutionLike]:
        raise NotImplementedError


class CanonicalTraceBuilder:
    def __init__(self, workflow_execution_loader: WorkflowExecutionLoader) -> None:
        self._workflow_execution_loader = workflow_execution_loader

    def build(self, trace_info: BaseTraceInfo) -> CanonicalTrace | None:
        match trace_info:
            case WorkflowTraceInfo():
                return self._build_workflow(trace_info)
            case MessageTraceInfo():
                return self._build_message(trace_info)
            # Existing supported trace types follow.
            case _:
                return None
```

The concrete loader owns the existing repository construction and service-account lookup. Load workflow executions once, call `build_workflow_hierarchy`, then emit spans in deterministic parent-before-child order. Preserve provider-neutral metadata and canonical token fields.

- [ ] **Step 4: Write failing unified runtime ordering tests**

```python
def test_runtime_supplies_core_publisher_to_adapter(adapter, coordinator, runtime):
    def emit(trace, parent, publish_parent_context):
        publish_parent_context("tool-exec", context)

    adapter.emit.side_effect = emit
    runtime.trace(workflow_info)
    coordinator.publish.assert_called_once_with("tool-exec", context)


def test_runtime_does_not_publish_when_adapter_fails_before_parent_acceptance(adapter, coordinator, runtime):
    adapter.emit.side_effect = RuntimeError("provider rejected run")
    with pytest.raises(RuntimeError):
        runtime.trace(workflow_info)
    coordinator.publish.assert_not_called()


def test_runtime_never_calls_legacy_provider_on_failure(runtime):
    with pytest.raises(RuntimeError):
        runtime.trace(workflow_info)
    assert not hasattr(runtime, "legacy_provider")
```

- [ ] **Step 5: Define the adapter protocol and runtime**

```python
ParentContextPublisher = Callable[[str, ProviderParentContext], None]


class UnifiedTraceAdapter(Protocol):
    @property
    def provider_name(self) -> str:
        raise NotImplementedError

    @property
    def scope(self) -> str:
        raise NotImplementedError

    def emit(
        self,
        trace: CanonicalTrace,
        parent: ParentResolution | None,
        publish_parent_context: ParentContextPublisher,
    ) -> None:
        raise NotImplementedError


class UnifiedTraceInstance(BaseTraceInstance):
    def trace(self, trace_info: BaseTraceInfo) -> None:
        canonical_trace = self._builder.build(trace_info)
        if canonical_trace is None:
            return
        parent = self._resolve_parent(canonical_trace)
        self._adapter.emit(canonical_trace, parent, self._coordinator.publish)
```

Do not add a legacy-provider field or fallback branch.

- [ ] **Step 6: Run core unified tests**

```bash
uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace -q
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add api/core/ops/unified_trace api/tests/unit_tests/core/ops/unified_trace
git commit -m "feat(trace): build and dispatch canonical traces"
```

---

### Task 6: Add the unified Phoenix adapter without modifying legacy Phoenix

**Files:**
- Create: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/unified_trace.py`
- Create: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py`
- Modify: `api/core/ops/unified_trace/registry.py`

- [ ] **Step 1: Write failing adapter contract tests**

Use mocked tracer/exporter objects. Assert:

```python
def test_emit_restores_w3c_parent_context(adapter, propagator):
    parent = restored_parent(provider="phoenix", provider_context={"traceparent": VALID_TRACEPARENT})
    adapter.emit(canonical_trace(), parent, MagicMock())
    propagator.extract.assert_called_once_with(carrier={"traceparent": VALID_TRACEPARENT})


def test_emit_creates_parent_before_child_in_canonical_order(adapter, tracer):
    adapter.emit(canonical_trace(parent_child=True), None, MagicMock())
    assert [call.kwargs["name"] for call in tracer.start_span.call_args_list] == ["root", "child"]


def test_emit_maps_chain_llm_retriever_tool_and_agent_kinds(adapter, tracer):
    adapter.emit(canonical_trace_with_all_kinds(), None, MagicMock())
    kinds = [call.kwargs["attributes"][SpanAttributes.OPENINFERENCE_SPAN_KIND] for call in tracer.start_span.call_args_list]
    assert kinds == ["CHAIN", "LLM", "RETRIEVER", "TOOL", "AGENT"]


def test_emit_maps_session_id_to_openinference_session(adapter, tracer):
    adapter.emit(canonical_trace(session_id="customer-session"), None, MagicMock())
    attributes = tracer.start_span.call_args.kwargs["attributes"]
    assert attributes[SpanAttributes.SESSION_ID] == "customer-session"


def test_emit_records_error_status_and_exception_event(adapter, tracer):
    adapter.emit(canonical_trace(error="boom"), None, MagicMock())
    span = tracer.start_span.return_value
    span.set_status.assert_called()
    span.add_event.assert_called_once()


def test_emit_exports_tool_traceparent_by_node_execution_id(adapter, propagator):
    propagator.inject.side_effect = lambda carrier: carrier.update({"traceparent": VALID_TRACEPARENT})
    publish = MagicMock()
    adapter.emit(canonical_tool_trace(execution_id="tool-exec"), None, publish)
    context = publish.call_args.args[1]
    assert publish.call_args.args[0] == "tool-exec"
    assert context.provider_context == {"traceparent": VALID_TRACEPARENT}


def test_scope_uses_endpoint_and_project_but_not_api_key(adapter):
    assert adapter.scope == destination_scope("phoenix", "https://phoenix.example", "project-a")
    assert "secret-key" not in adapter.scope


def test_legacy_phoenix_class_is_not_constructed(monkeypatch: pytest.MonkeyPatch, config):
    legacy = MagicMock(side_effect=AssertionError("legacy constructor called"))
    monkeypatch.setattr("dify_trace_arize_phoenix.arize_phoenix_trace.ArizePhoenixDataTrace", legacy)
    UnifiedPhoenixTrace(config)
    legacy.assert_not_called()
```

Add a golden structural test for workflow → iteration → wrapper → LLM and outer tool → nested workflow.

- [ ] **Step 2: Run and confirm red**

```bash
uv run --project api pytest \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py -q
```

Expected: missing `dify_trace_arize_phoenix.unified_trace`.

- [ ] **Step 3: Implement the adapter**

The new module may reuse provider configuration classes but must not construct or delegate to `ArizePhoenixDataTrace`. Implement:

```python
class UnifiedPhoenixAdapter:
    provider_name = "phoenix"

    def __init__(self, config: PhoenixConfig) -> None:
        self._config = config
        self._tracer, self._processor = setup_unified_tracer(config)
        self._propagator = TraceContextTextMapPropagator()
        self._scope = destination_scope("phoenix", config.endpoint, config.project)

    def emit(
        self,
        trace: CanonicalTrace,
        parent: ParentResolution | None,
        publish_parent_context: ParentContextPublisher,
    ) -> None:
        span_by_id: dict[str, Span] = {}
        for canonical_span in trace.spans:
            span = start_otel_span(canonical_span, span_by_id, parent)
            span_by_id[canonical_span.id] = span
            if canonical_span.kind is CanonicalSpanKind.TOOL:
                context = export_phoenix_parent_context(self.scope, trace.trace_id, span)
                publish_parent_context(canonical_span.id, context)
            finish_otel_span(span, canonical_span)
```

Map canonical fields to OpenInference attributes. Restore only a validated `traceparent` from the coordinator. End every span in `finally`, set workflow/root error from canonical status, and export tool context only after the tool span has been created successfully.

A small amount of Phoenix-specific setup duplication is intentional during migration. Do not move helpers out of or edit `arize_phoenix_trace.py`.

- [ ] **Step 4: Register Phoenix lazily**

In `UnifiedTraceProviderConfigMap.__getitem__`, return the unified Phoenix trace-instance factory only for `TracingProviderEnum.PHOENIX`. Do not register Arize in this phase.

The factory composes `CanonicalTraceBuilder`, `ParentContextCoordinator`, and `UnifiedPhoenixAdapter`; it does not subclass the legacy Phoenix class.

- [ ] **Step 5: Run Phoenix legacy and unified tests together**

```bash
uv run --project api pytest \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py -q
```

Expected: both suites pass, demonstrating the legacy file was not behaviorally changed.

- [ ] **Step 6: Run manager routing tests and commit**

```bash
uv run --project api pytest api/tests/unit_tests/core/ops/test_ops_trace_manager.py -q
git add api/core/ops/unified_trace/registry.py \
  api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/unified_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_unified_trace.py
git commit -m "feat(trace): add unified Phoenix adapter"
```

---

### Task 7: Add the unified LangSmith adapter

**Files:**
- Create: `api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py`
- Create: `api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py`
- Modify: `api/core/ops/unified_trace/registry.py`

- [ ] **Step 1: Write failing LangSmith contract tests**

Mock `langsmith.Client.create_run` and assert:

```python
def test_root_trace_id_equals_root_run_id(adapter, client):
    adapter.emit(canonical_trace(root_span_id="root-run"), None, MagicMock())
    assert client.create_run.call_args_list[0].kwargs["trace_id"] == "root-run"


def test_parent_run_id_matches_canonical_parent(adapter, client):
    adapter.emit(canonical_trace(parent_child=True), None, MagicMock())
    assert client.create_run.call_args_list[1].kwargs["parent_run_id"] == "root-run"


def test_dotted_order_contains_parent_order(adapter, client):
    adapter.emit(canonical_trace(parent_child=True), None, MagicMock())
    root_order = client.create_run.call_args_list[0].kwargs["dotted_order"]
    child_order = client.create_run.call_args_list[1].kwargs["dotted_order"]
    assert child_order.startswith(f"{root_order}.")


def test_thread_session_is_set_on_root_metadata(adapter, client):
    adapter.emit(canonical_trace(session_id="customer-session"), None, MagicMock())
    metadata = client.create_run.call_args_list[0].kwargs["extra"]["metadata"]
    assert metadata["session_id"] == "customer-session"


def test_iteration_children_are_not_flattened(adapter, client):
    adapter.emit(canonical_iteration_trace(), None, MagicMock())
    calls = {call.kwargs["id"]: call.kwargs for call in client.create_run.call_args_list}
    assert calls["llm-exec"]["parent_run_id"] == "iteration-wrapper"


def test_nested_workflow_restores_trace_parent_and_dotted_order(adapter, client):
    adapter.emit(canonical_trace(root_span_id="inner-workflow"), restored_langsmith_parent(), MagicMock())
    root = client.create_run.call_args_list[0].kwargs
    assert root["trace_id"] == "outer-root"
    assert root["parent_run_id"] == "outer-tool-execution"
    assert root["dotted_order"].startswith("parent.order.")


def test_tool_context_is_exported_after_create_run_returns(adapter, client):
    publish = MagicMock()
    adapter.emit(canonical_tool_trace(execution_id="tool-exec"), None, publish)
    assert client.create_run.called
    assert publish.call_args.args[0] == "tool-exec"
    assert publish.call_args.args[1].parent_id == "tool-exec"


def test_create_run_failure_exports_no_context(adapter, client):
    client.create_run.side_effect = RuntimeError("rejected")
    publish = MagicMock()
    with pytest.raises(RuntimeError, match="rejected"):
        adapter.emit(canonical_tool_trace(execution_id="tool-exec"), None, publish)
    publish.assert_not_called()


def test_scope_excludes_api_key(adapter):
    assert adapter.scope == destination_scope("langsmith", "https://smith.example", "project-a")
    assert "secret-key" not in adapter.scope


def test_legacy_langsmith_class_is_not_constructed(monkeypatch: pytest.MonkeyPatch, config):
    legacy = MagicMock(side_effect=AssertionError("legacy constructor called"))
    monkeypatch.setattr("dify_trace_langsmith.langsmith_trace.LangSmithDataTrace", legacy)
    UnifiedLangSmithTrace(config)
    legacy.assert_not_called()
```

For the nested test, use a coordinator result containing:

```python
ProviderParentContext(
    provider="langsmith",
    scope="scope-a",
    trace_id="outer-root",
    parent_id="outer-tool-execution",
    provider_context={"dotted_order": "parent.order"},
)
```

- [ ] **Step 2: Run and confirm red**

```bash
uv run --project api pytest \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py -q
```

Expected: missing unified LangSmith module.

- [ ] **Step 3: Implement LangSmith mapping**

```python
class UnifiedLangSmithAdapter:
    provider_name = "langsmith"

    def __init__(self, config: LangSmithConfig) -> None:
        self._client = Client(api_key=config.api_key, api_url=config.endpoint)
        self._project_name = config.project
        self._scope = destination_scope("langsmith", config.endpoint, config.project)

    def emit(
        self,
        trace: CanonicalTrace,
        parent: ParentResolution | None,
        publish_parent_context: ParentContextPublisher,
    ) -> None:
        trace_id, parent_id, parent_order = resolve_langsmith_parent(trace, parent)
        order_by_span_id: dict[str, str] = {}
        for span in trace.spans:
            span_parent_id = order_parent_id(span, parent_id)
            span_parent_order = order_by_span_id.get(span.parent_id or "", parent_order)
            dotted_order = generate_dotted_order(span.id, span.start_time, span_parent_order)
            self._client.create_run(**to_langsmith_run(span, trace_id, span_parent_id, dotted_order))
            order_by_span_id[span.id] = dotted_order
            if span.kind is CanonicalSpanKind.TOOL:
                context = langsmith_parent_context(self.scope, trace_id, span.id, dotted_order)
                publish_parent_context(span.id, context)
```

Use canonical span IDs as LangSmith run IDs where they are valid UUIDs. Preserve the current root-run protocol: `trace_id` equals the root Run ID, while an external Dify trace ID remains metadata. Generate every child `dotted_order` from its actual canonical parent's order, not directly from the workflow order.

Set root metadata:

```python
metadata = {**root_span.metadata, "session_id": trace.session_id}
```

Immediately after a tool run is accepted, call the core-supplied `publish_parent_context` callback with its root trace ID, tool run ID, and dotted order. Do not wait for the rest of the canonical tree to finish, because a later sibling failure must not hide an already accepted parent from a nested workflow.

- [ ] **Step 4: Register LangSmith lazily**

Add only `TracingProviderEnum.LANGSMITH` beside Phoenix in the unified registry. Unregistered providers continue raising `KeyError` so the manager selects legacy.

- [ ] **Step 5: Run legacy and unified LangSmith tests**

```bash
uv run --project api pytest \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_langsmith_trace.py \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py -q
```

Expected: both suites pass.

- [ ] **Step 6: Commit**

```bash
git add api/core/ops/unified_trace/registry.py \
  api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py \
  api/providers/trace/trace-langsmith/tests/unit_tests/langsmith_trace/test_unified_trace.py
git commit -m "feat(trace): add unified LangSmith adapter"
```

---

### Task 8: Lock down retry exhaustion and fallback boundaries

**Files:**
- Modify: `api/tests/unit_tests/tasks/test_ops_trace_task.py:83-305`
- Modify: `api/tests/unit_tests/core/ops/unified_trace/test_provider.py`
- Modify: `api/tests/unit_tests/core/ops/test_ops_trace_manager.py`

- [ ] **Step 1: Add failing end-to-end dispatch boundary tests**

Add tests proving:

```python
def test_registered_unified_provider_failure_is_not_redispatched_to_legacy(
    task_dependencies, file_info, unified, legacy
):
    task_dependencies.manager.get_ops_trace_instance.return_value = unified
    unified.trace.side_effect = RuntimeError("terminal provider failure")
    process_trace_tasks.run(file_info)
    unified.trace.assert_called_once()
    legacy.trace.assert_not_called()


def test_pending_unified_parent_retries_until_task_budget(task_dependencies, file_info, trace_instance):
    task_dependencies.manager.get_ops_trace_instance.return_value = trace_instance
    trace_instance.trace.side_effect = PendingTraceParentContextError("outer-tool")
    with patch.object(process_trace_tasks, "retry", side_effect=Retry()) as retry:
        with pytest.raises(Retry):
            _run_task(file_info, retries=0)
    retry.assert_called_once_with(
        exc=trace_instance.trace.side_effect,
        countdown=process_trace_tasks.default_retry_delay,
    )


def test_exhausted_pending_parent_counts_failure_and_deletes_payload(
    task_dependencies, file_info, trace_instance
):
    trace_instance.trace.side_effect = PendingTraceParentContextError("outer-tool")
    _run_task(file_info, retries=process_trace_tasks.max_retries)
    task_dependencies.redis.incr.assert_called_once()
    task_dependencies.storage.delete.assert_called_once()


def test_cross_scope_parent_emits_linked_root_without_retry(runtime, adapter, coordinator):
    coordinator.resolve.return_value = ParentResolution.linked_root(parent_context())
    runtime.trace(make_nested_workflow_trace_info())
    adapter.emit.assert_called_once()
    assert adapter.emit.call_args.args[1].kind is ParentResolutionKind.LINKED_ROOT


def test_unregistered_provider_uses_legacy_with_switch_enabled(
    monkeypatch: pytest.MonkeyPatch, mock_db
):
    configure_trace_app_and_decrypted_config(monkeypatch, mock_db, provider="dummy")
    monkeypatch.setattr(dify_config, "OPS_TRACE_UNIFIED_ENABLED", True)
    monkeypatch.setattr("core.ops.ops_trace_manager.unified_provider_config_map", FakeProviderMap({}))
    assert isinstance(OpsTraceManager.get_ops_trace_instance("app-id"), LegacyTrace)
```

- [ ] **Step 2: Run and confirm any missing behavior**

```bash
uv run --project api pytest \
  api/tests/unit_tests/tasks/test_ops_trace_task.py \
  api/tests/unit_tests/core/ops/test_ops_trace_manager.py \
  api/tests/unit_tests/core/ops/unified_trace/test_provider.py -q
```

Expected: new tests fail only where integration wiring is incomplete.

- [ ] **Step 3: Make the minimum wiring corrections**

Expected production changes should be unnecessary because Tasks 1, 4, and 5 define these semantics. If a test exposes a gap, correct only the responsible existing unified module. Do not add a catch-all fallback to `OpsTraceManager` or `process_trace_tasks`.

- [ ] **Step 4: Re-run the boundary suite**

```bash
uv run --project api pytest \
  api/tests/unit_tests/tasks/test_ops_trace_task.py \
  api/tests/unit_tests/core/ops/test_ops_trace_manager.py \
  api/tests/unit_tests/core/ops/unified_trace/test_provider.py -q
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/tests/unit_tests/tasks/test_ops_trace_task.py \
  api/tests/unit_tests/core/ops/test_ops_trace_manager.py \
  api/tests/unit_tests/core/ops/unified_trace/test_provider.py \
  api/core/ops/unified_trace api/core/ops/ops_trace_manager.py
git commit -m "test(trace): enforce unified dispatch isolation"
```

---

### Task 9: Verify the complete implementation

**Files:**
- No planned production changes

- [ ] **Step 1: Verify changed-file formatting and lint**

Run Ruff on the exact Python paths:

```bash
uv run --project api ruff format --check \
  api/core/ops/unified_trace \
  api/core/ops/ops_trace_manager.py \
  api/core/ops/exceptions.py \
  api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/unified_trace.py \
  api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py \
  api/tests/unit_tests/core/ops/unified_trace
uv run --project api ruff check \
  api/core/ops/unified_trace \
  api/core/ops/ops_trace_manager.py \
  api/core/ops/exceptions.py \
  api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/unified_trace.py \
  api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py \
  api/tests/unit_tests/core/ops/unified_trace
```

Expected: both commands exit 0.

- [ ] **Step 2: Run all focused unit tests**

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/ops \
  api/tests/unit_tests/tasks/test_ops_trace_task.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests \
  api/providers/trace/trace-langsmith/tests/unit_tests -q
```

Expected: 0 failures.

- [ ] **Step 3: Run backend type checking for affected packages**

Use the repository-supported type command:

```bash
make type-check
```

Expected: exit 0. If repository-wide unrelated failures exist, record their exact paths and separately run the narrowest configured checker over the changed modules.

- [ ] **Step 4: Confirm isolation mechanically**

```bash
rg -n "ArizePhoenixDataTrace|LangSmithDataTrace" \
  api/core/ops/unified_trace \
  api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/unified_trace.py \
  api/providers/trace/trace-langsmith/src/dify_trace_langsmith/unified_trace.py
rg -n "trace:phoenix:parent_span" api/core/ops/unified_trace
```

Expected: no matches. Configuration-class imports are allowed; legacy trace-class names and legacy Redis keys are not.

- [ ] **Step 5: Check final diff and line count**

```bash
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git diff --numstat origin/main...HEAD
```

Expected: no whitespace errors; changes remain within the files listed in this plan except narrowly justified corrections.

- [ ] **Step 6: Commit any verification-only corrections**

If formatting or typing required edits:

```bash
git add -u
git commit -m "fix(trace): satisfy unified tracing checks"
```

Do not create an empty commit when no corrections were required.
