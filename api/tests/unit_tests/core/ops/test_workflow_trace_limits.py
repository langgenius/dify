"""Workflow capture failures, checkpoint ownership, and recording limits."""

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from unittest.mock import Mock, create_autospec
from uuid import uuid4

import pytest

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext, InvokeFrom, UserFrom
from core.ops.trace_data import CompletedTrace, TraceProviderSettings, TraceSource, make_span_id
from core.ops.workflow_trace import WorkflowTraceRecorder, WorkflowTraceState
from graphon.engine_events import (
    EngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunExceptionEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from graphon.entities.base_node_data import BaseNodeData
from graphon.node_events import NodeRunResult
from graphon.nodes.base.node import Node


@pytest.fixture
def source() -> TraceSource:
    return TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()))


def workflow_node(
    source: TraceSource,
    *,
    node_type: str = "code",
    workflow_id: str = "workflow",
    invocation_id: str | None = None,
) -> Node[BaseNodeData]:
    app_id = source.app_id or source.pipeline_id
    assert app_id is not None
    node = create_autospec(
        Node,
        instance=True,
        execution_id=str(uuid4()),
        id="node",
        title="Node",
        node_type=node_type,
        workflow_id=workflow_id,
        run_context={
            DIFY_RUN_CONTEXT_KEY: DifyRunContext(
                tenant_id=source.tenant_id,
                app_id=app_id,
                user_id="user",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
                workflow_tool_invocation_id=invocation_id,
            )
        },
    )
    node.version.return_value = "1"
    return node


def start_node(recorder: WorkflowTraceRecorder, node: Node[BaseNodeData]) -> None:
    with recorder.node_run_context(node):
        recorder.record_workflow_event(
            NodeRunStartedEvent(
                id=node.execution_id,
                node_id=node.id,
                node_type=node.node_type,
                node_title=node.title,
                start_at=datetime.now(UTC),
            )
        )


@pytest.fixture
def submitted() -> list[CompletedTrace]:
    return []


@pytest.fixture
def recorder(source: TraceSource, submitted: list[CompletedTrace]) -> WorkflowTraceRecorder:
    return WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace, _settings=(): submitted.append(trace) is None,
    )


@pytest.mark.parametrize(
    ("outcome", "status", "error"),
    [
        (GraphRunPartialSucceededEvent(exceptions_count=1, outputs={"answer": "partial"}), "handled_error", None),
        (GraphRunFailedEvent(error="engine failed"), "error", "engine failed"),
        (GraphRunAbortedEvent(reason="user stopped", outputs={"answer": "partial"}), "cancelled", "user stopped"),
    ],
)
def test_terminal_graph_outcomes_close_unfinished_nodes(
    source: TraceSource,
    recorder: WorkflowTraceRecorder,
    submitted: list[CompletedTrace],
    outcome: EngineEvent,
    status: str,
    error: str | None,
) -> None:
    start_node(recorder, workflow_node(source))
    recorder.on_event(GraphRunStartedEvent())
    recorder.on_event(outcome)

    assert recorder.finish_workflow_trace()
    trace = submitted[0]
    root, node = trace.spans
    assert root.status == status
    assert root.error == error
    terminal_failure = status in {"error", "cancelled"}
    assert node.status == ("error" if terminal_failure else "incomplete")
    assert node.error == error
    assert node.ended_at == (root.ended_at if terminal_failure else None)
    assert trace.complete is terminal_failure
    assert trace.truncation["reasons"] == ([] if terminal_failure else ["unfinished_execution"])


def test_paused_run_is_not_exported_before_resume(
    source: TraceSource, recorder: WorkflowTraceRecorder, submitted: list[CompletedTrace]
) -> None:
    recorder.on_event(GraphRunPausedEvent())
    assert not recorder.finish_workflow_trace()
    with recorder.node_run_context(workflow_node(source)):
        pass
    recorder.on_event(GraphRunSucceededEvent())
    assert not recorder.finish_workflow_trace()
    assert not submitted


def test_pre_upgrade_resume_and_host_failure_explain_missing_events(source: TraceSource) -> None:
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        resumed_without_state=True,
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    recorder.on_event(GraphRunPausedEvent())
    assert recorder.finish_workflow_trace(error="resume host failed")
    assert submitted[0].spans[0].error == "resume host failed"
    assert submitted[0].truncation["reasons"] == ["pre_upgrade_checkpoint", "host_execution_failed"]


def test_missing_parent_is_omitted_without_reparenting(
    source: TraceSource, recorder: WorkflowTraceRecorder, submitted: list[CompletedTrace]
) -> None:
    node = workflow_node(source)
    with recorder.node_run_context(node, parent_execution_id=str(uuid4())):
        recorder.on_event(
            NodeRunStartedEvent(
                id=node.execution_id,
                node_id=node.id,
                node_type="code",
                node_title=node.title,
                start_at=datetime.now(UTC),
            )
        )
    recorder.on_event(GraphRunSucceededEvent())
    recorder.finish_workflow_trace()
    assert len(submitted[0].spans) == 1
    assert submitted[0].truncation["reasons"] == ["missing_execution_parent", "missing_execution_identity"]


@pytest.mark.parametrize("limit", [1, 2])
def test_node_and_retry_span_limits_keep_the_root(source: TraceSource, limit: int) -> None:
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        max_spans=limit,
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    node = workflow_node(source)
    start_node(recorder, node)
    recorder.on_event(
        NodeRunRetryEvent(
            id=node.execution_id,
            node_id=node.id,
            node_type="code",
            node_title=node.title,
            start_at=datetime.now(UTC),
            retry_index=1,
            error="retry",
        )
    )
    recorder.on_event(
        NodeRunSucceededEvent(
            id=node.execution_id,
            node_id=node.id,
            node_type="code",
            start_at=datetime.now(UTC),
        )
    )
    recorder.on_event(GraphRunSucceededEvent())
    recorder.finish_workflow_trace()
    trace = submitted[0]
    assert len(trace.spans) == limit
    assert not trace.complete
    assert trace.truncation["reasons"] == (
        ["span_limit", "missing_execution_identity"] if limit == 1 else ["span_limit"]
    )
    assert trace.truncation["omitted_spans"] == 1


@pytest.mark.parametrize("invalid_owner", ["tenant", "app"])
def test_child_destinations_must_match_the_authorized_child(source: TraceSource, invalid_owner: str) -> None:
    child_app_id = str(uuid4())
    settings = TraceProviderSettings(
        tenant_id=str(uuid4()) if invalid_owner == "tenant" else source.tenant_id,
        app_id=str(uuid4()) if invalid_owner == "app" else child_app_id,
        provider_name="langsmith",
        config_id=str(uuid4()),
    )
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda _: True,
        load_provider_settings=lambda _tenant, _app: [settings],
    )
    with pytest.raises(ValueError, match="Child workflow tracing destination owner mismatch"):
        recorder.register_workflow_source(
            tenant_id=source.tenant_id,
            app_id=child_app_id,
            workflow_id="child-workflow",
            workflow_version="1",
            invocation_id=str(uuid4()),
            parent_execution_id=str(uuid4()),
        )


def test_foreign_child_rejects_the_whole_trace(
    recorder: WorkflowTraceRecorder, submitted: list[CompletedTrace]
) -> None:
    recorder.register_workflow_source(
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        workflow_id="foreign-workflow",
        workflow_version="1",
        invocation_id=str(uuid4()),
        parent_execution_id=str(uuid4()),
    )
    recorder.on_event(GraphRunSucceededEvent())
    assert not recorder.finish_workflow_trace()
    assert not submitted


def test_child_settings_failure_keeps_parent_capture_and_loads_once(source: TraceSource) -> None:
    submitted: list[CompletedTrace] = []
    load_settings = Mock(side_effect=RuntimeError("settings unavailable"))
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
        load_provider_settings=load_settings,
    )
    tool = workflow_node(source, node_type="tool")
    start_node(recorder, tool)
    invocation_id = str(uuid4())
    child_app_id = str(uuid4())
    for _ in range(2):
        recorder.register_workflow_source(
            tenant_id=source.tenant_id,
            app_id=child_app_id,
            workflow_id="child-workflow",
            workflow_version="1",
            invocation_id=invocation_id,
            parent_execution_id=tool.execution_id,
        )
    recorder.on_event(GraphRunAbortedEvent(reason="stop"))
    assert recorder.finish_workflow_trace()
    recorder.register_workflow_source(
        tenant_id=source.tenant_id,
        app_id=child_app_id,
        workflow_id="child-workflow",
        workflow_version="1",
        invocation_id=str(uuid4()),
        parent_execution_id=tool.execution_id,
    )
    load_settings.assert_called_once_with(source.tenant_id, child_app_id)
    assert len(submitted) == 1
    assert submitted[0].spans[1].status == "error"


@pytest.fixture
def checkpoint(source: TraceSource) -> WorkflowTraceState:
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda *_: True,
    )
    tool = workflow_node(source, node_type="tool")
    start_node(recorder, tool)
    invocation_id = str(uuid4())
    child_source = source.model_copy(update={"app_id": str(uuid4())})
    assert child_source.app_id is not None
    recorder.register_workflow_source(
        tenant_id=source.tenant_id,
        app_id=child_source.app_id,
        workflow_id="child-workflow",
        workflow_version="2",
        invocation_id=invocation_id,
        parent_execution_id=tool.execution_id,
    )
    child = workflow_node(child_source, workflow_id="child-workflow", invocation_id=invocation_id)
    with recorder.node_run_context(child, parent_execution_id=tool.execution_id):
        pass
    recorder.on_event(GraphRunPausedEvent())
    return WorkflowTraceState.model_validate(recorder.save_pause_state())


@pytest.mark.parametrize(
    ("corruption", "error"),
    [
        ("missing_root", "Invalid workflow trace checkpoint spans"),
        ("duplicate_span", "Invalid workflow trace checkpoint spans"),
        ("child_span", "Invalid child workflow trace checkpoint spans"),
        ("child_tenant", "Child workflow trace checkpoint owner mismatch"),
        ("child_destination", "Child workflow trace checkpoint owner mismatch"),
        ("span_app", "Workflow trace checkpoint span owner mismatch"),
        ("span_pipeline", "Workflow trace checkpoint span owner mismatch"),
        ("open_span", "Invalid workflow trace checkpoint execution identities"),
        ("execution_span", "Invalid workflow trace checkpoint execution identities"),
    ],
)
def test_corrupt_checkpoint_cannot_restore_other_owners_or_executions(
    source: TraceSource, checkpoint: WorkflowTraceState, corruption: str, error: str
) -> None:
    child = next(iter(checkpoint.child_workflows.values()))
    match corruption:
        case "missing_root":
            checkpoint.spans.pop(0)
        case "duplicate_span":
            checkpoint.spans.append(checkpoint.spans[0])
        case "child_span":
            child.node_span_ids.append(str(uuid4()))
        case "child_tenant":
            child.source = child.source.model_copy(update={"tenant_id": str(uuid4())})
        case "child_destination":
            child.provider_settings.append(
                TraceProviderSettings(
                    tenant_id=source.tenant_id,
                    app_id=str(uuid4()),
                    provider_name="langsmith",
                    config_id=str(uuid4()),
                )
            )
        case "span_app":
            checkpoint.spans[1] = checkpoint.spans[1].model_copy(update={"source_app_id": str(uuid4())})
        case "span_pipeline":
            checkpoint.spans[1] = checkpoint.spans[1].model_copy(update={"source_pipeline_id": str(uuid4())})
        case "open_span":
            checkpoint.open_span_ids.append(str(uuid4()))
        case "execution_span":
            checkpoint.execution_span_ids["unknown"] = str(uuid4())
    with pytest.raises(ValueError, match=error):
        WorkflowTraceRecorder(
            source=source,
            workflow_id="workflow",
            workflow_version="1",
            inputs={},
            submit_completed_trace=lambda _: True,
            pause_state=checkpoint.model_dump(mode="json"),
        )


def test_resume_prunes_orphaned_spans_and_explains_the_loss(
    source: TraceSource, checkpoint: WorkflowTraceState
) -> None:
    tool, child = checkpoint.spans[1:]
    checkpoint.spans[1] = tool.model_copy(update={"parent_span_id": str(uuid4())})
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
        pause_state=checkpoint.model_dump(mode="json"),
    )
    recorder.on_event(GraphRunSucceededEvent())
    assert recorder.finish_workflow_trace()
    trace = submitted[0]
    assert len(trace.spans) == 1
    assert not trace.complete
    assert trace.truncation == {"reasons": ["invalid_span_parent"], "omitted_spans": 2}
    assert {tool.span_id, child.span_id}.isdisjoint(span.span_id for span in trace.spans)


def test_resume_declines_capture_when_restored_bytes_cannot_be_reserved(
    source: TraceSource, checkpoint: WorkflowTraceState
) -> None:
    submit = Mock(return_value=True)
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=submit,
        pause_state=checkpoint.model_dump(mode="json"),
        reserve_recording_bytes=lambda _tenant, _count: False,
    )
    recorder.on_event(GraphRunSucceededEvent())
    assert not recorder.finish_workflow_trace()
    submit.assert_not_called()


def test_unfinished_child_exports_its_own_incomplete_tree_on_host_failure(source: TraceSource) -> None:
    child_app_id = str(uuid4())
    settings = TraceProviderSettings(
        tenant_id=source.tenant_id, app_id=child_app_id, provider_name="langsmith", config_id=str(uuid4())
    )
    submitted: list[tuple[CompletedTrace, Sequence[TraceProviderSettings]]] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace, settings=(): submitted.append((trace, settings)) is None,
        load_provider_settings=lambda _tenant, _app: [settings],
    )
    tool = workflow_node(source, node_type="tool")
    start_node(recorder, tool)
    recorder.register_workflow_source(
        tenant_id=source.tenant_id,
        app_id=child_app_id,
        workflow_id="child-workflow",
        workflow_version="2",
        invocation_id=str(uuid4()),
        parent_execution_id=tool.execution_id,
    )
    assert recorder.finish_workflow_trace(error="worker stopped")
    child, parent = submitted
    assert child[1] == [settings]
    assert child[0].source.app_id == child_app_id
    assert child[0].spans[0].parent_span_id is None
    assert child[0].spans[0].error == "worker stopped"
    assert not child[0].complete
    assert child[0].links == (parent[0].trace_id,)
    assert parent[0].source == source


@pytest.mark.parametrize("max_spans", [3, 20])
def test_agent_results_preserve_parentage_usage_and_limits(source: TraceSource, max_spans: int) -> None:
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        max_spans=max_spans,
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    agent = workflow_node(source, node_type="agent")
    start_node(recorder, agent)
    outputs = {
        "json": [
            {"id": "thought", "label": "1 Thought", "metadata": {"prompt_tokens": 2, "total_tokens": 3}},
            {"id": "tool", "parent_id": "thought", "label": "CALL Search", "error": "unavailable", "data": {"q": "x"}},
            {"id": "fallback", "status": "error", "metadata": None},
            {"invalid": True},
            "ignored",
        ]
    }
    recorder.on_event(
        NodeRunSucceededEvent(
            id=agent.execution_id,
            node_id=agent.id,
            node_type="agent",
            start_at=datetime.now(UTC),
            node_run_result=NodeRunResult(outputs=outputs),
        )
    )
    recorder.on_event(GraphRunSucceededEvent())
    recorder.finish_workflow_trace()
    trace = submitted[0]
    assert len(trace.spans) == min(max_spans, 5)
    thought = trace.spans[2]
    assert thought.span_type == "llm"
    assert thought.usage == {"prompt_tokens": 2, "total_tokens": 3}
    assert thought.attributes["metrics_from_parent"] is True
    assert thought.started_at is None
    if max_spans == 3:
        assert not trace.complete
        assert trace.truncation["reasons"] == ["span_limit"]
    else:
        tool, fallback = trace.spans[3:]
        assert tool.parent_span_id == thought.span_id
        assert tool.span_type == "tool"
        assert tool.error == "unavailable"
        assert tool.outputs == {"q": "x"}
        assert fallback.span_name == "Agent step"
        assert fallback.span_type == "agent"
        assert fallback.status == "error"
        assert trace.complete


def test_agent_without_structured_steps_and_handled_node_error(
    source: TraceSource, recorder: WorkflowTraceRecorder, submitted: list[CompletedTrace]
) -> None:
    agent = workflow_node(source, node_type="agent")
    start_node(recorder, agent)
    recorder.on_event(
        NodeRunExceptionEvent(
            id=agent.execution_id,
            node_id=agent.id,
            node_type="agent",
            start_at=datetime(2026, 1, 1),
            error="handled",
            node_run_result=NodeRunResult(outputs={"json": "not steps"}),
        )
    )
    recorder.on_event(GraphRunPartialSucceededEvent(exceptions_count=1))
    recorder.finish_workflow_trace()
    assert len(submitted[0].spans) == 2
    assert submitted[0].spans[1].status == "handled_error"
    assert submitted[0].complete


@pytest.mark.parametrize("inputs", [{"value": "x" * 70_000}, {"value": ["x"] * 300}])
def test_large_values_are_bounded_and_mark_the_trace_incomplete(
    source: TraceSource, inputs: Mapping[str, object]
) -> None:
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs=inputs,
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    recorder.on_event(GraphRunSucceededEvent())
    recorder.finish_workflow_trace()
    assert len(submitted[0].model_dump_json().encode()) < 70_000
    assert submitted[0].truncation["reasons"] == ["value_size_limit"]


def test_recording_backpressure_replaces_values_and_releases_only_reserved_bytes(source: TraceSource) -> None:
    submitted: list[CompletedTrace] = []
    released: list[tuple[str, int]] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={"value": "unavailable"},
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
        reserve_recording_bytes=lambda _tenant, count: count == 4096,
        release_recording_bytes=lambda tenant, count: released.append((tenant, count)),
    )
    recorder.on_event(GraphRunSucceededEvent())
    recorder.finish_workflow_trace()
    assert submitted[0].spans[0].inputs == "[recording byte limit]"
    assert submitted[0].truncation["reasons"] == ["recording_byte_limit"]
    assert released == [(source.tenant_id, 4096)]


def test_recording_callback_failure_does_not_interrupt_the_engine(source: TraceSource) -> None:
    submitted: list[CompletedTrace] = []
    reserve = Mock(return_value=True)
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
        reserve_recording_bytes=reserve,
    )
    node = workflow_node(source)
    with recorder.node_run_context(node):
        reserve.side_effect = RuntimeError("accounting unavailable")
        recorder.on_event(
            NodeRunStartedEvent(
                id=node.execution_id,
                node_id=node.id,
                node_type="code",
                node_title=node.title,
                start_at=datetime.now(UTC),
            )
        )
    reserve.side_effect = None
    recorder.on_event(GraphRunSucceededEvent())
    assert recorder.finish_workflow_trace()
    assert submitted[0].truncation["reasons"] == ["capture_error", "unfinished_execution"]


def test_large_retry_history_stays_within_the_delivery_byte_limit(source: TraceSource) -> None:
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    node = workflow_node(source)
    start_node(recorder, node)
    for attempt in range(1, 81):
        recorder.on_event(
            NodeRunRetryEvent(
                id=node.execution_id,
                node_id=node.id,
                node_type="code",
                node_title=node.title,
                start_at=datetime.now(UTC),
                retry_index=attempt,
                error="retry",
                node_run_result=NodeRunResult(inputs={"value": "x" * 60_000}, outputs={"value": "x" * 60_000}),
            )
        )
    assert recorder.finish_workflow_trace(error="retry limit exceeded")
    trace = submitted[0]
    reasons = trace.truncation["reasons"]
    assert isinstance(reasons, list)
    assert "trace_size_limit" in reasons
    assert "recording_byte_limit" in reasons
    assert not trace.complete
    assert len(trace.model_dump_json().encode()) <= 8 * 1024 * 1024


def test_pipeline_nodes_keep_pipeline_ownership(source: TraceSource) -> None:
    pipeline_source = source.model_copy(update={"app_id": None, "pipeline_id": str(uuid4())})
    recorder = WorkflowTraceRecorder(
        source=pipeline_source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda _: True,
    )
    node = workflow_node(pipeline_source, node_type="knowledge-retrieval")
    with recorder.node_run_context(node):
        pass
    checkpoint = WorkflowTraceState.model_validate(recorder.save_pause_state())
    node_span = checkpoint.spans[1]
    assert node_span.span_id == make_span_id(source.tenant_id, source.operation_id, node.execution_id)
    assert node_span.source_app_id is None
    assert node_span.source_pipeline_id == pipeline_source.pipeline_id
    assert node_span.span_type == "retrieval"
