# Agent Unified Tracing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export privacy-safe, provider-neutral Agent v2 execution and human-wait spans through unified tracing without changing Agent execution semantics.

**Architecture:** Normalize Pydantic AI backend events into stable semantic events, collect them into private Agent-run fragments, and merge those fragments with `HumanWaitRecord`s in `CanonicalTraceBuilder`. Start an enabled unified collector once per execution host trace; persist its workflow fragments in the existing pause-state payload, but retain Agent App fragments only until its Message trace dispatch completes. All collection, persistence, construction, and export failures are isolated and recorded as incomplete trace metadata.

**Tech Stack:** Python 3.12, Pydantic v2, SQLAlchemy, Graphon, Celery, Vitest/React Testing Library, existing unified trace provider adapters.

**Capture policy fixed for this implementation:** recursively redact mapping keys matching `authorization`, `credential`, `secret`, `token`, `api_key`, `password`, `signature`, or `environment` (case-insensitive); replace JWE-shaped strings (`xxxxx.yyyyy.zzzzz`) with `[REDACTED]`; truncate each string and serialized scalar to 16 KiB, each list to 100 entries, and each mapping to 100 entries. Preserve `truncated: true` beside every shortened value. No new runtime setting, migration, or provider API is required.

---

## File structure

- Create `api/core/ops/unified_trace/agent_events.py`: provider-neutral semantic event, fragment, collection-gate, and bounded-data models.
- Create `api/core/ops/unified_trace/agent_normalizer.py`: `AgentEventNormalizer` protocol and Pydantic-AI-only concrete normalizer.
- Create `api/core/ops/unified_trace/agent_collector.py`: fail-open semantic collector and fragment lifecycle helpers.
- Create `api/core/ops/unified_trace/human_wait.py`: private form-to-wait normalization and correlation helpers.
- Modify `api/clients/agent_backend/event_adapter.py`: expose raw backend stream data to tracing without making tracing depend on application event handling.
- Modify `api/core/workflow/nodes/agent_v2/agent_node.py` and `api/core/app/apps/agent_app/app_runner.py`: create/run/finish collectors and record semantic events without changing terminal handling.
- Modify `api/core/app/entities/app_invoke_entities.py`, `api/core/app/layers/pause_state_persist_layer.py`, and resume paths: serialize workflow collector fragments in private pause state and restore them.
- Modify `api/core/ops/entities/trace_entity.py`, `api/core/ops/ops_trace_manager.py`, `api/tasks/ops_trace_task.py`, and `api/core/ops/unified_trace/trace_builder.py`: transport private fragments to the canonical builder, merge spans, and delete only after final dispatch outcome.
- Modify `api/core/repositories/human_input_repository.py`, `api/services/human_input_service.py`, and `api/tasks/human_input_timeout_tasks.py`: emit normalized waits for form creation and terminal form transitions.
- Modify `api/core/ops/unified_trace/entities.py`: add `HUMAN_WAIT`, span links, and incomplete-export metadata support.
- Modify `web/features/agent-v2/agent-detail/monitoring/page.tsx`; reuse `web/app/(commonLayout)/app/(appDetailLayout)/[appId]/overview/tracing/panel.tsx` as a parameterized component; add Agent App backing-App resolution hook/service and translations.
- Create focused tests under `api/tests/unit_tests/core/ops/unified_trace/`, `api/tests/unit_tests/core/app/apps/agent_app/`, `api/tests/unit_tests/core/workflow/nodes/agent_v2/`, `api/tests/unit_tests/tasks/`, and `web/features/agent-v2/agent-detail/monitoring/__tests__/`.

### Task 1: Define the stable trace contracts and privacy boundary

**Files:**
- Create: `api/core/ops/unified_trace/agent_events.py`
- Create: `api/core/ops/unified_trace/agent_normalizer.py`
- Test: `api/tests/unit_tests/core/ops/unified_trace/test_agent_events.py`
- Test: `api/tests/unit_tests/core/ops/unified_trace/test_agent_normalizer.py`

- [ ] **Step 1: Write failing normalization and redaction tests**

```python
def test_normalizer_emits_provider_neutral_tool_call_without_secret() -> None:
    event = make_pydantic_ai_tool_call(args={"api_key": "secret", "city": "Paris"})
    normalized = PydanticAIAgentEventNormalizer().normalize(event)
    assert normalized.kind is AgentSemanticEventKind.TOOL_CALL
    assert normalized.payload["arguments"]["api_key"] == "[REDACTED]"
    assert normalized.payload["arguments"]["city"] == "Paris"


def test_bounded_value_marks_truncation_and_replaces_jwe() -> None:
    value = {"reply": "x" * (16 * 1024 + 1), "state": "a.b.c"}
    bounded = bound_trace_value(value)
    assert bounded["reply"]["truncated"] is True
    assert bounded["state"] == "[REDACTED]"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace/test_agent_events.py api/tests/unit_tests/core/ops/unified_trace/test_agent_normalizer.py -q`

Expected: FAIL because the event contracts and normalizer do not exist.

- [ ] **Step 3: Implement immutable provider-neutral contracts and the concrete normalizer**

```python
class AgentSemanticEventKind(StrEnum):
    RUN_STARTED = "run_started"
    LLM = "llm"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    RUN_FINISHED = "run_finished"

class AgentEventNormalizer(Protocol):
    def normalize(self, event: object) -> tuple[AgentSemanticEvent, ...]: ...

class PydanticAIAgentEventNormalizer:
    def normalize(self, event: PydanticAIStreamRunEvent) -> tuple[AgentSemanticEvent, ...]:
        # Convert only stable Pydantic AI parts; return () for unknown parts.
        ...
```

Keep imports of `pydantic_ai.messages` and `PydanticAIStreamRunEvent` exclusively in `agent_normalizer.py`. `bound_trace_value` must recurse before any fragment is created and never return raw sensitive values.

- [ ] **Step 4: Run the focused tests**

Run: `uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace/test_agent_events.py api/tests/unit_tests/core/ops/unified_trace/test_agent_normalizer.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/core/ops/unified_trace/agent_events.py api/core/ops/unified_trace/agent_normalizer.py api/tests/unit_tests/core/ops/unified_trace/test_agent_events.py api/tests/unit_tests/core/ops/unified_trace/test_agent_normalizer.py
git commit -m "feat(trace): define agent semantic event contracts"
```

### Task 2: Collect independent Agent-run fragments fail-open

**Files:**
- Create: `api/core/ops/unified_trace/agent_collector.py`
- Test: `api/tests/unit_tests/core/ops/unified_trace/test_agent_collector.py`

- [ ] **Step 1: Write failing collector tests**

```python
def test_collector_creates_sibling_llm_and_tool_records() -> None:
    collector = AgentSemanticTraceCollector(run_id="run-1", role="initial")
    collector.consume(llm_event())
    collector.consume(tool_call_event(tool_call_id="call-1"))
    collector.consume(tool_result_event(tool_call_id="call-1"))
    fragment = collector.finish(output="done")
    assert [record.kind for record in fragment.operations] == ["llm", "tool"]
    assert fragment.operations[1].metadata["tool_call_id"] == "call-1"


def test_collector_returns_partial_fragment_when_one_event_is_invalid() -> None:
    collector = AgentSemanticTraceCollector(run_id="run-1", role="resume")
    collector.consume(object())
    fragment = collector.finish(output="done")
    assert fragment.complete is False
    assert fragment.dropped_event_count == 1
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace/test_agent_collector.py -q`

Expected: FAIL because `AgentSemanticTraceCollector` does not exist.

- [ ] **Step 3: Implement collector and serializable fragment models**

```python
class AgentSemanticTraceCollector:
    def consume(self, event: AgentSemanticEvent) -> None:
        try:
            self._consume(event)
        except Exception:
            self._warning_codes.add("agent_event_dropped")
            self._dropped_event_count += 1

    def finish(self, *, output: object = None, error: str | None = None) -> AgentRunTraceFragment:
        return AgentRunTraceFragment(
            run_id=self._run_id, role=self._role, complete=not self._warning_codes,
            warning_codes=sorted(self._warning_codes), dropped_event_count=self._dropped_event_count,
        )
```

Represent `agent_run`, LLM turns, and completed tool calls only. Pair call/result by `tool_call_id`; leave unpaired calls as incomplete operations rather than inventing nesting. All exception handling stays inside tracing code.

- [ ] **Step 4: Run tests and type checks**

Run: `uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace/test_agent_collector.py -q && uv run --project api basedpyright api/core/ops/unified_trace`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/core/ops/unified_trace/agent_collector.py api/tests/unit_tests/core/ops/unified_trace/test_agent_collector.py
git commit -m "feat(trace): collect agent run fragments"
```

### Task 3: Add generic normalized human-wait records

**Files:**
- Create: `api/core/ops/unified_trace/human_wait.py`
- Modify: `api/core/repositories/human_input_repository.py`
- Modify: `api/services/human_input_service.py`
- Modify: `api/tasks/human_input_timeout_tasks.py`
- Test: `api/tests/unit_tests/core/ops/unified_trace/test_human_wait.py`
- Test: `api/tests/unit_tests/core/repositories/test_human_input_form_repository_impl.py`

- [ ] **Step 1: Write failing lifecycle tests**

```python
def test_wait_record_uses_form_creation_and_submission_times() -> None:
    record = HumanWaitRecord.from_form(form(created_at=START, submitted_at=END, status="submitted"))
    assert record.start_time == START
    assert record.end_time == END
    assert record.outcome == "submitted"


def test_wait_record_does_not_export_form_tokens_or_recipient_payload() -> None:
    record = HumanWaitRecord.from_form(form(access_token="private", recipient_payload="private"))
    assert "private" not in record.model_dump_json()
```

- [ ] **Step 2: Run tests to verify failure**

Run: `uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace/test_human_wait.py -q`

Expected: FAIL because `HumanWaitRecord` does not exist.

- [ ] **Step 3: Implement form normalization and lifecycle publication**

```python
class HumanWaitRecord(BaseModel):
    wait_id: str
    owner_id: str
    owner_kind: Literal["workflow_node", "agent_node", "agent_message"]
    start_time: datetime
    end_time: datetime | None
    outcome: Literal["waiting", "submitted", "timed_out", "expired", "canceled"]
    input: object | None = None
    output: object | None = None
```

Build records from `HumanInputForm` only, using `created_at`, `submitted_at`, expiration/timeout transition time, and sanitized form definition/submission. Store the record with its workflow/message owner correlation; do not query or serialize deliveries, recipients, access tokens, or upload tokens.

- [ ] **Step 4: Run focused tests**

Run: `uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace/test_human_wait.py api/tests/unit_tests/core/repositories/test_human_input_form_repository_impl.py api/tests/unit_tests/tasks/test_human_input_timeout_tasks.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/core/ops/unified_trace/human_wait.py api/core/repositories/human_input_repository.py api/services/human_input_service.py api/tasks/human_input_timeout_tasks.py api/tests/unit_tests/core/ops/unified_trace/test_human_wait.py api/tests/unit_tests/core/repositories/test_human_input_form_repository_impl.py
git commit -m "feat(trace): normalize human wait lifecycle"
```

### Task 4: Merge fragments into canonical traces

**Files:**
- Modify: `api/core/ops/unified_trace/entities.py`
- Modify: `api/core/ops/unified_trace/trace_builder.py`
- Test: `api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py`
- Test: `api/tests/unit_tests/core/ops/unified_trace/test_entities.py`

- [ ] **Step 1: Write failing canonical-tree tests**

```python
def test_workflow_agent_fragment_is_child_of_agent_node_with_sibling_operations() -> None:
    trace = builder.build(workflow_info(metadata={"agent_fragments": [fragment("node-exec")]}))
    spans = {span.id: span for span in trace.spans}
    assert spans["agent-run-1"].parent_id == "node-exec"
    assert spans["agent-run-1:llm:0"].parent_id == "agent-run-1"
    assert spans["agent-run-1:tool:0"].parent_id == "agent-run-1"


def test_agent_app_resume_wait_uses_link_not_cross_trace_parent() -> None:
    trace = builder.build(message_info(metadata={"human_waits": [resumed_wait("wait-1", "message-1")]}))
    wait = trace.spans[-1]
    assert wait.parent_id == "message-2"
    assert wait.links == ("message-1",)
```

- [ ] **Step 2: Run tests to verify failure**

Run: `uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py api/tests/unit_tests/core/ops/unified_trace/test_entities.py -q`

Expected: FAIL because spans have no human-wait kind, links, or fragment merging.

- [ ] **Step 3: Implement canonical conversion**

```python
class CanonicalSpanKind(StrEnum):
    CHAIN = "chain"
    LLM = "llm"
    RETRIEVER = "retriever"
    TOOL = "tool"
    AGENT = "agent"
    HUMAN_WAIT = "human_wait"

class CanonicalSpan(BaseModel):
    links: tuple[str, ...] = ()
```

Read private `agent_fragments` and `human_waits` only from trace-info metadata. For workflows, attach waits directly to their node execution and each agent run below its Agent node. For Agent App messages, attach its run below the Message root; emit requested and resumed waits as separate same-session spans with a link to the first Message. Add `complete`, `warning_codes`, and `dropped_event_count` to the affected span metadata.

- [ ] **Step 4: Run focused tests**

Run: `uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/core/ops/unified_trace/entities.py api/core/ops/unified_trace/trace_builder.py api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py api/tests/unit_tests/core/ops/unified_trace/test_entities.py
git commit -m "feat(trace): build agent and human wait spans"
```

### Task 5: Gate collection and wire the Agent backend event paths

**Files:**
- Modify: `api/core/ops/ops_trace_manager.py`
- Modify: `api/clients/agent_backend/event_adapter.py`
- Modify: `api/core/workflow/nodes/agent_v2/agent_node.py`
- Modify: `api/core/app/apps/agent_app/app_runner.py`
- Test: `api/tests/unit_tests/core/workflow/nodes/agent_v2/test_agent_node.py`
- Test: `api/tests/unit_tests/core/app/apps/agent_app/test_app_runner.py`

- [ ] **Step 1: Write failing host-routing tests**

```python
def test_workflow_agent_uses_workflow_app_collection_gate() -> None:
    node = make_node(trace_collector_factory=recording_factory(enabled_for="workflow-app"))
    list(node._run())
    assert recording_factory.app_ids == ["workflow-app"]


def test_agent_app_resume_starts_a_new_collector_with_resume_role() -> None:
    runner.run(...)
    assert collector_factory.created[0].role == "resume"
```

- [ ] **Step 2: Run tests to verify failure**

Run: `uv run --project api pytest api/tests/unit_tests/core/workflow/nodes/agent_v2/test_agent_node.py api/tests/unit_tests/core/app/apps/agent_app/test_app_runner.py -q`

Expected: FAIL because neither execution path creates a collector.

- [ ] **Step 3: Implement a locked collection gate and event forwarding**

```python
class AgentTraceCollectionGate:
    @classmethod
    def for_app(cls, app_id: str) -> "AgentTraceCollectionGate":
        return cls(enabled=OpsTraceManager.get_ops_trace_instance(app_id) is not None)
```

Create the gate at Workflow/Chatflow start and persist its boolean in the generate entity; reuse it after resume. Create the Agent App gate per Message. Forward raw Pydantic AI stream events to `PydanticAIAgentEventNormalizer` before normal application adaptation; retain the existing adapter output and terminal behavior. Each backend create/stream attempt creates a separate collector; set `role="resume"` only when `deferred_tool_results` is present. Catch all tracing exceptions at each call site and log them without changing output, retries, pause, cancellation, or backend cancellation behavior.

- [ ] **Step 4: Run focused tests**

Run: `uv run --project api pytest api/tests/unit_tests/core/workflow/nodes/agent_v2/test_agent_node.py api/tests/unit_tests/core/app/apps/agent_app/test_app_runner.py api/tests/unit_tests/core/ops/test_ops_trace_manager.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/core/ops/ops_trace_manager.py api/clients/agent_backend/event_adapter.py api/core/workflow/nodes/agent_v2/agent_node.py api/core/app/apps/agent_app/app_runner.py api/tests/unit_tests/core/workflow/nodes/agent_v2/test_agent_node.py api/tests/unit_tests/core/app/apps/agent_app/test_app_runner.py
git commit -m "feat(trace): collect agent backend executions"
```

### Task 5a: Stitch Workflow-as-Tool children to Agent tool-call spans

**Files:**
- Modify: `api/core/ops/unified_trace/agent_collector.py`
- Modify: `api/core/ops/unified_trace/trace_builder.py`
- Modify: `dify-agent/src/dify_agent/layers/dify_core_tools/client.py`
- Modify: `dify-agent/src/dify_agent/layers/dify_core_tools/layer.py`
- Modify: `api/services/entities/agent_tool_inner.py`
- Modify: `api/services/agent_tool_inner_service.py`
- Modify: `api/core/tools/workflow_as_tool/tool.py`
- Test: `api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py`
- Test: `api/tests/unit_tests/services/test_agent_tool_inner_service.py`
- Test: `dify-agent/tests/local/dify_agent/layers/dify_core_tools/test_client.py`
- Test: `dify-agent/tests/local/dify_agent/layers/dify_core_tools/test_layer.py`

- [ ] **Step 1: Write failing span-parent and boundary propagation tests**

```python
def test_workflow_as_tool_span_publishes_parent_context_for_its_tool_call_id() -> None:
    trace = builder.build(workflow_info(metadata={"agent_fragments": [workflow_tool_fragment("call-1")]}))
    span = next(span for span in trace.spans if span.id == "agent-run-1:tool:call-1")
    assert span.publishes_parent_context is True


def test_core_workflow_tool_sets_opaque_agent_tool_span_as_parent_context() -> None:
    request = make_invoke_request(provider_type="workflow", tool_call_span_id="agent-run-1:tool:call-1")
    AgentToolInnerService().invoke(request, session=session)
    workflow_tool.set_parent_trace_context.assert_called_once_with(
        parent_workflow_run_id="outer-run",
        parent_node_execution_id="agent-run-1:tool:call-1",
    )
```

```python
async def test_core_tools_client_sends_tool_call_correlation() -> None:
    await client.invoke(execution_context=context, tool_config=workflow_tool, tool_parameters={"q": "x"}, tool_call_id="call-1")
    assert request.json()["caller"]["tool_call_span_id"] == "agent-run-1:tool:call-1"
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py api/tests/unit_tests/services/test_agent_tool_inner_service.py -q && uv run --project dify-agent pytest dify-agent/tests/local/dify_agent/layers/dify_core_tools/test_client.py dify-agent/tests/local/dify_agent/layers/dify_core_tools/test_layer.py -q`

Expected: FAIL because core-tool requests carry no Agent tool-call correlation and Agent tool spans do not publish a parent context.

- [ ] **Step 3: Propagate the normalized span ID without exposing it to the model or tool arguments**

```python
# The collector owns the stable opaque ID used by both canonical conversion and core-tool invocation.
tool_span_id = f"{agent_run_id}:tool:{tool_call_id}"

class _DifyCoreToolsCaller(BaseModel):
    tenant_id: str
    user_id: str
    user_from: str
    app_id: str
    invoke_from: str
    parent_workflow_run_id: str | None = None
    tool_call_span_id: str | None = None
```

At the Pydantic AI core-tool invocation boundary, obtain the active tool-call ID from the runtime context, map it to the collector's stable `tool_span_id`, and send only that opaque value with the existing caller context. Extend the API inner request DTO and validate that both correlation fields are either present together or absent. For `provider_type == "workflow"`, call the existing `WorkflowTool.set_parent_trace_context()` with the outer workflow run ID and opaque span ID before `ToolEngine.generic_invoke`; clear it in `finally`. Do not add either value to `tool_parameters`, persisted tool inputs, model-visible schemas, or tool observations.

- [ ] **Step 4: Mark only Workflow-as-Tool Agent tool spans as parent-context publishers**

```python
CanonicalSpan(
    id=operation.span_id,
    parent_id=agent_run_span_id,
    name=operation.name,
    kind=CanonicalSpanKind.TOOL,
    publishes_parent_context=operation.provider_type == "workflow",
)
```

Use the existing `ParentContextCoordinator.publish()` behavior after the provider has successfully emitted the Agent tool span. Child Workflow traces continue to pass this opaque key in `ParentTraceContext.parent_node_execution_id`; `ParentContextCoordinator.resolve()` therefore keeps its existing retry on a not-yet-published compatible parent and its linked-root fallback for an incompatible destination. Do not change the legacy Workflow-node `can_parent_workflow` behavior.

- [ ] **Step 5: Run focused tests**

Run: `uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py api/tests/unit_tests/core/ops/unified_trace/test_parent_context.py api/tests/unit_tests/services/test_agent_tool_inner_service.py -q && uv run --project dify-agent pytest dify-agent/tests/local/dify_agent/layers/dify_core_tools/test_client.py dify-agent/tests/local/dify_agent/layers/dify_core_tools/test_layer.py -q`

Expected: PASS, including a child trace that retries until its outer Agent tool span publishes context and a mismatched provider destination that becomes a linked root.

- [ ] **Step 6: Commit**

```bash
git add api/core/ops/unified_trace/agent_collector.py api/core/ops/unified_trace/trace_builder.py api/services/entities/agent_tool_inner.py api/services/agent_tool_inner_service.py api/core/tools/workflow_as_tool/tool.py api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py api/tests/unit_tests/services/test_agent_tool_inner_service.py dify-agent/src/dify_agent/layers/dify_core_tools/client.py dify-agent/src/dify_agent/layers/dify_core_tools/layer.py dify-agent/tests/local/dify_agent/layers/dify_core_tools/test_client.py dify-agent/tests/local/dify_agent/layers/dify_core_tools/test_layer.py
git commit -m "feat(trace): parent workflow tools under agent calls"
```

### Task 6: Preserve Workflow fragments across repeated pauses

**Files:**
- Modify: `api/core/app/entities/app_invoke_entities.py`
- Modify: `api/core/app/layers/pause_state_persist_layer.py`
- Modify: `api/core/app/apps/workflow/app_generator.py`
- Modify: `api/core/app/apps/advanced_chat/app_generator.py`
- Modify: `api/core/app/workflow/layers/persistence.py`
- Test: `api/tests/unit_tests/core/app/layers/test_pause_state_persist_layer.py`
- Test: `api/tests/unit_tests/core/app/apps/workflow/test_app_generator_extra.py`

- [ ] **Step 1: Write failing pause/resume tests**

```python
def test_pause_state_round_trip_retains_private_trace_fragments() -> None:
    state = persist_pause(entity_with_fragments([fragment("run-1")]))
    restored = restore_pause(state)
    assert restored.trace_fragments == [fragment("run-1")]


def test_terminal_workflow_trace_contains_fragments_from_both_runs() -> None:
    trace = finish_after_two_pauses()
    assert {span.name for span in trace.spans} >= {"agent_run", "human_wait"}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `uv run --project api pytest api/tests/unit_tests/core/app/layers/test_pause_state_persist_layer.py api/tests/unit_tests/core/app/apps/workflow/test_app_generator_extra.py -q`

Expected: FAIL because tracing fragments are not serialized with pause state.

- [ ] **Step 3: Persist only private collector state**

```python
class WorkflowTraceState(BaseModel):
    collection_enabled: bool
    agent_fragments: list[AgentRunTraceFragment] = []
    human_waits: list[HumanWaitRecord] = []
```

Add this field to the serialized application generation entity used by `PauseStatePersistenceLayer`, explicitly excluding it from API responses and Message metadata. On every pause save the accumulated state; on resume restore and append to it. When the workflow reaches succeeded, partially succeeded, failed, or stopped, pass it to the single final `WORKFLOW_TRACE` task. Do not enqueue a final trace task on pause.

- [ ] **Step 4: Run pause and workflow tests**

Run: `uv run --project api pytest api/tests/unit_tests/core/app/layers/test_pause_state_persist_layer.py api/tests/unit_tests/core/app/apps/workflow api/tests/unit_tests/core/app/apps/advanced_chat -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/core/app/entities/app_invoke_entities.py api/core/app/layers/pause_state_persist_layer.py api/core/app/apps/workflow/app_generator.py api/core/app/apps/advanced_chat/app_generator.py api/core/app/workflow/layers/persistence.py api/tests/unit_tests/core/app/layers/test_pause_state_persist_layer.py api/tests/unit_tests/core/app/apps/workflow/test_app_generator_extra.py
git commit -m "feat(trace): retain workflow fragments through pauses"
```

### Task 7: Dispatch fragments safely and enforce cleanup lifecycle

**Files:**
- Modify: `api/core/ops/entities/trace_entity.py`
- Modify: `api/core/ops/ops_trace_manager.py`
- Modify: `api/tasks/ops_trace_task.py`
- Modify: `api/core/app/task_pipeline/easy_ui_based_generate_task_pipeline.py`
- Modify: `api/core/app/apps/agent_app/app_generator.py`
- Test: `api/tests/unit_tests/tasks/test_ops_trace_task.py`
- Test: `api/tests/unit_tests/core/ops/test_ops_trace_manager.py`

- [ ] **Step 1: Write failing dispatch lifecycle tests**

```python
def test_retry_keeps_fragment_payload_until_accepted_retry() -> None:
    task = stored_task_with_agent_fragments()
    task.retry = raise_retry
    with pytest.raises(Retry):
        process_trace_tasks(task, file_info)
    assert storage.exists(file_path)


def test_terminal_dispatch_failure_deletes_fragment_payload() -> None:
    process_trace_tasks(task_that_raises_value_error, file_info)
    assert not storage.exists(file_path)
```

- [ ] **Step 2: Run tests to verify failure**

Run: `uv run --project api pytest api/tests/unit_tests/tasks/test_ops_trace_task.py api/tests/unit_tests/core/ops/test_ops_trace_manager.py -q`

Expected: FAIL because fragment payloads are not carried by trace info.

- [ ] **Step 3: Carry fragments inside private trace-task payloads**

```python
class BaseTraceInfo(BaseModel):
    metadata: dict[str, Any]
    private_trace_state: PrivateTraceState | None = Field(default=None, exclude=True)
```

Make `TraceTask` construct `WorkflowTraceInfo`/`MessageTraceInfo` with the serialized private state, and restore it in `process_trace_tasks` before unified building. The Celery storage object is the retryable fragment owner: retain it only after `self.retry` raises `Retry`; delete it after successful emit or any terminal exception. Preserve existing legacy/enterprise dispatch behavior and never expose `private_trace_state` through public schemas.

- [ ] **Step 4: Run dispatch tests**

Run: `uv run --project api pytest api/tests/unit_tests/tasks/test_ops_trace_task.py api/tests/unit_tests/core/ops/test_ops_trace_manager.py api/tests/unit_tests/core/ops/unified_trace -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/core/ops/entities/trace_entity.py api/core/ops/ops_trace_manager.py api/tasks/ops_trace_task.py api/core/app/task_pipeline/easy_ui_based_generate_task_pipeline.py api/core/app/apps/agent_app/app_generator.py api/tests/unit_tests/tasks/test_ops_trace_task.py api/tests/unit_tests/core/ops/test_ops_trace_manager.py
git commit -m "feat(trace): dispatch and clean agent fragments"
```

### Task 8: Add Agent App HITL trace boundaries

**Files:**
- Modify: `api/core/app/apps/agent_app/app_runner.py`
- Modify: `api/core/app/apps/agent_app/app_generator.py`
- Modify: `api/tasks/app_generate/resume_agent_app_task.py`
- Test: `api/tests/unit_tests/core/app/apps/agent_app/test_app_runner.py`
- Test: `api/tests/unit_tests/tasks/test_resume_agent_app_task.py`

- [ ] **Step 1: Write failing two-message HITL tests**

```python
def test_initial_agent_app_message_exports_requested_wait_and_drops_fragment() -> None:
    runner.run(...deferred_tool_call...)
    trace = dispatched_message_trace()
    assert trace.spans[-1].metadata["phase"] == "requested"
    assert fragment_store.for_message("message-1") == []


def test_resumed_agent_app_message_links_wait_to_initial_message() -> None:
    resume_agent_app_execution(conversation_id="conversation-1", form_id="wait-1")
    trace = dispatched_message_trace()
    assert trace.spans[-1].links == ("message-1",)
    assert trace.spans[-1].metadata["wait_duration_ms"] > 0
```

- [ ] **Step 2: Run tests to verify failure**

Run: `uv run --project api pytest api/tests/unit_tests/core/app/apps/agent_app/test_app_runner.py api/tests/unit_tests/tasks/test_resume_agent_app_task.py -q`

Expected: FAIL because Agent App waits are not attached to Message trace payloads.

- [ ] **Step 3: Implement independent Message trace records**

```python
# initial ask_human turn
private_state.human_waits.append(wait.with_phase("requested", message_id=message_id))
# submitted continuation
private_state.human_waits.append(wait.with_phase("resumed", message_id=message_id, linked_message_id=initial_message_id))
```

On deferred `ask_human`, include the requested wait in M1 before the ordinary Message trace task is queued. On submission continuation, create a new collector and M2 state, calculate duration from the form creation timestamp, and add only the resumed wait plus its link. Do not preserve M1 Agent fragments in the conversation binding or across the human wait.

- [ ] **Step 4: Run focused tests**

Run: `uv run --project api pytest api/tests/unit_tests/core/app/apps/agent_app/test_app_runner.py api/tests/unit_tests/tasks/test_resume_agent_app_task.py api/tests/unit_tests/core/ops/unified_trace/test_trace_builder.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/core/app/apps/agent_app/app_runner.py api/core/app/apps/agent_app/app_generator.py api/tasks/app_generate/resume_agent_app_task.py api/tests/unit_tests/core/app/apps/agent_app/test_app_runner.py api/tests/unit_tests/tasks/test_resume_agent_app_task.py
git commit -m "feat(trace): trace agent app human waits"
```

### Task 9: Reuse App tracing controls in Agent v2 Monitor

**Files:**
- Modify: `web/app/(commonLayout)/app/(appDetailLayout)/[appId]/overview/tracing/panel.tsx`
- Modify: `web/features/agent-v2/agent-detail/monitoring/page.tsx`
- Create: `web/features/agent-v2/agent-detail/monitoring/tracing-panel.tsx`
- Modify: `web/i18n/en-US/agent-v-2.json`
- Modify: `web/i18n/zh-Hans/agent-v-2.json`
- Test: `web/features/agent-v2/agent-detail/monitoring/__tests__/page.spec.tsx`

- [ ] **Step 1: Write failing Monitor UI tests**

```tsx
it('renders the existing tracing controls for the backing App and explains scope', async () => {
  render(<AgentMonitoringPage agentId="agent-1" />)
  expect(await screen.findByText('Tracing applies only to Agent App conversations.')).toBeInTheDocument()
  expect(fetchTracingStatus).toHaveBeenCalledWith({ appId: 'backing-app-1' })
})
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm --dir web test features/agent-v2/agent-detail/monitoring/__tests__/page.spec.tsx`

Expected: FAIL because Monitor has no tracing controls.

- [ ] **Step 3: Parameterize and reuse the existing App panel**

```tsx
export type TracingPanelProps = { appId: string, readOnly?: boolean }
const Panel: FC<TracingPanelProps> = ({ appId, readOnly = false }) => {
  // Remove pathname-derived appId; preserve existing APIs and permission behavior.
}
```

Resolve the Agent App backing App ID through the already-loaded Agent detail query; render the parameterized panel in Monitor only when it exists. Add the explicit scope text: Agent App settings govern Agent App conversations only; Workflow/Chatflow Agent nodes use the invoking Workflow App’s configuration. Do not add an Agent tracing API or storage.

- [ ] **Step 4: Run UI tests and lint**

Run: `pnpm --dir web test features/agent-v2/agent-detail/monitoring/__tests__/page.spec.tsx app/'(commonLayout)'/app/'(appDetailLayout)'/'[appId]'/overview/tracing/__tests__/panel.spec.tsx && pnpm --dir web lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/'(commonLayout)'/app/'(appDetailLayout)'/'[appId]'/overview/tracing/panel.tsx web/features/agent-v2/agent-detail/monitoring/page.tsx web/features/agent-v2/agent-detail/monitoring/tracing-panel.tsx web/i18n/en-US/agent-v-2.json web/i18n/zh-Hans/agent-v-2.json web/features/agent-v2/agent-detail/monitoring/__tests__/page.spec.tsx
git commit -m "feat(web): expose tracing controls in agent monitor"
```

### Task 10: Run regression verification and document boundaries

**Files:**
- Modify: `docs/superpowers/specs/2026-07-29-agent-unified-tracing-design.md`
- Test: all tests above

- [ ] **Step 1: Add the capture-limit and failure-mode decisions to the design**

```markdown
## Implementation defaults

The API redacts sensitive keys and JWE-shaped values before fragment persistence. It bounds strings to 16 KiB and collections to 100 entries. These are fixed internal safety limits, not App settings. Trace failures are logged and surfaced only through canonical incomplete metadata.
```

- [ ] **Step 2: Run backend regressions**

Run: `uv run --project api pytest api/tests/unit_tests/core/ops/unified_trace api/tests/unit_tests/core/workflow/nodes/agent_v2 api/tests/unit_tests/core/app/apps/agent_app api/tests/unit_tests/tasks/test_ops_trace_task.py api/tests/unit_tests/tasks/test_resume_agent_app_task.py -q`

Expected: PASS.

- [ ] **Step 3: Run frontend verification**

Run: `pnpm --dir web test features/agent-v2/agent-detail/monitoring/__tests__/page.spec.tsx app/'(commonLayout)'/app/'(appDetailLayout)'/'[appId]'/overview/tracing/__tests__/panel.spec.tsx && pnpm --dir web lint`

Expected: PASS.

- [ ] **Step 4: Inspect the final diff for secret leakage and scope regressions**

Run: `git diff HEAD~10..HEAD -- api web docs | rg -n "api[_-]?key|authorization|access_token|session_snapshot|JWE"`

Expected: occurrences are exclusively redaction tests, field-name matchers, or existing non-export persistence; no raw value is added to a canonical span.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-07-29-agent-unified-tracing-design.md
git commit -m "docs(trace): record unified agent tracing defaults"
```
