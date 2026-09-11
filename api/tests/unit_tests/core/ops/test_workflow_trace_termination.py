"""Terminal engine events preserve persisted node outcomes and observed times."""

from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from types import SimpleNamespace
from typing import cast
from unittest.mock import Mock
from uuid import uuid4

import pytest

from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY
from core.ops.trace_data import CompletedTrace, TraceProviderSettings, TraceSource
from core.ops.workflow_trace import WorkflowTraceRecorder
from core.workflow.workflow_entry import WorkflowEntry
from graphon.engine.command import InMemoryChannel
from graphon.engine_events import (
    EngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    NodeRunPauseRequestedEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from graphon.entities.pause_reason import SchedulingPause
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events import NodeRunResult
from graphon.runtime import ReadOnlyRuntimeStateWrapper, RuntimeState, VariablePool
from tests.unit_tests.core.ops.test_workflow_trace_compatibility import make_persistence_layer
from tests.unit_tests.core.ops.test_workflow_trace_limits import start_node, workflow_node


@pytest.mark.parametrize(
    ("event", "root_status", "error"),
    [
        (GraphRunFailedEvent(error="branch failed"), "error", "branch failed"),
        (GraphRunAbortedEvent(reason="user stopped"), "cancelled", "user stopped"),
        (GraphRunAbortedEvent(), "cancelled", "Workflow execution aborted"),
        (GraphRunAbortedEvent(reason=""), "cancelled", "Workflow execution aborted"),
    ],
)
def test_terminal_events_match_persisted_running_nodes_and_keep_finished_siblings(
    event: EngineEvent, root_status: str, error: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()), actor_id="user")
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={"question": "original"},
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    state = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=1)
    persistence, _ = make_persistence_layer(recorder, state)
    for layer in (recorder, persistence):
        layer.initialize(ReadOnlyRuntimeStateWrapper(state), InMemoryChannel())
        layer.on_event(GraphRunStartedEvent())

    started = datetime(2026, 9, 12, 1)
    terminal_time = started + timedelta(seconds=5)
    nodes = [workflow_node(source, node_type="llm") for _ in range(3)]
    for index, node in enumerate(nodes):
        with recorder.node_run_context(node):
            start = NodeRunStartedEvent(
                id=node.execution_id,
                node_id=node.id,
                node_type=node.node_type,
                node_title=node.title,
                start_at=started,
                node_run_result=NodeRunResult(inputs={"branch": index}),
            )
            recorder.on_event(start)
            persistence.on_event(start)
    usage = LLMUsage.empty_usage().model_copy(update={"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8})
    succeeded = NodeRunSucceededEvent(
        id=nodes[0].execution_id,
        node_id=nodes[0].id,
        node_type=nodes[0].node_type,
        start_at=started,
        finished_at=started + timedelta(seconds=1),
        node_run_result=NodeRunResult(inputs={"branch": 0}, outputs={"answer": "done"}, llm_usage=usage),
    )
    recorder.on_event(succeeded)
    persistence.on_event(succeeded)
    completed_sibling = next(
        span for span in recorder._spans.values() if span.node_execution_id == nodes[0].execution_id
    )
    clock = Mock(wraps=datetime)
    clock.now.return_value = terminal_time.replace(tzinfo=UTC)
    monkeypatch.setattr("core.ops.workflow_trace.datetime", clock)
    monkeypatch.setattr("core.app.workflow.layers.persistence.naive_utc_now", lambda: terminal_time)
    recorder.on_event(event)
    persistence.on_event(event)
    clock.now.return_value = terminal_time.replace(tzinfo=UTC) + timedelta(seconds=20)
    assert recorder.finish_workflow_trace()

    trace = CompletedTrace.model_validate_json(submitted[0].model_dump_json())
    root, sibling, *running = trace.spans
    assert trace.complete
    assert trace.truncation["reasons"] == []
    assert root.status == root_status
    assert root.error == error
    assert root.ended_at == terminal_time.replace(tzinfo=UTC)
    assert sibling == completed_sibling
    assert sibling.usage == usage.model_dump(mode="json")
    for index, span in enumerate(running, start=1):
        assert span.node_execution_id is not None
        persisted = persistence._node_execution_cache[span.node_execution_id]
        assert persisted.status == WorkflowNodeExecutionStatus.FAILED
        assert span.status == "error"
        assert span.attributes["node_status"] == "failed"
        assert span.error == persisted.error == error
        assert persisted.finished_at is not None
        assert span.started_at is not None
        assert span.ended_at is not None
        assert span.ended_at == persisted.finished_at.replace(tzinfo=UTC) == root.ended_at
        assert (span.ended_at - span.started_at).total_seconds() == persisted.elapsed_time == 5
        assert span.inputs == {"branch": index}


@pytest.mark.parametrize("event", [GraphRunFailedEvent(error="failed"), GraphRunAbortedEvent(reason="stopped")])
def test_terminal_event_closes_child_workflow_views_and_concurrent_branches(event: EngineEvent) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()), actor_id="owner")
    child_source = source.model_copy(update={"app_id": str(uuid4())})
    assert child_source.app_id is not None
    settings = TraceProviderSettings(
        tenant_id=source.tenant_id, app_id=child_source.app_id, provider_name="recording", config_id=str(uuid4())
    )
    submitted: list[tuple[CompletedTrace, tuple[TraceProviderSettings, ...]]] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        load_provider_settings=lambda tenant_id, app_id: (
            (settings,) if (tenant_id, app_id) == (source.tenant_id, child_source.app_id) else ()
        ),
        submit_completed_trace=lambda trace, destinations=(): submitted.append((trace, tuple(destinations))) is None,
    )
    tool = workflow_node(source, node_type="tool")
    start_node(recorder, tool)
    invocation_id = str(uuid4())
    recorder.register_workflow_source(
        tenant_id=source.tenant_id,
        app_id=child_source.app_id,
        workflow_id="child-workflow",
        workflow_version="2",
        invocation_id=invocation_id,
        parent_execution_id=tool.execution_id,
    )
    nodes = [
        workflow_node(child_source, workflow_id="child-workflow", invocation_id=invocation_id),
        workflow_node(child_source, workflow_id="child-workflow", invocation_id=invocation_id),
        workflow_node(source),
    ]
    ready = Barrier(len(nodes))

    def start_branch(index: int) -> None:
        node = nodes[index]
        with recorder.node_run_context(node, parent_execution_id=tool.execution_id if index < 2 else None):
            ready.wait(timeout=5)
            recorder.record_workflow_event(
                NodeRunStartedEvent(
                    id=node.execution_id,
                    node_id=node.id,
                    node_type=node.node_type,
                    node_title=node.title,
                    start_at=datetime.now(UTC),
                    node_run_result=NodeRunResult(inputs={"branch": index}),
                )
            )

    with ThreadPoolExecutor(max_workers=3) as workers:
        list(workers.map(start_branch, range(3)))
    recorder.on_event(event)
    assert recorder.finish_workflow_trace()
    child, parent = submitted
    assert child[1] == (settings,)
    assert child[0].source.app_id == child_source.app_id
    assert child[0].source.tenant_id == parent[0].source.tenant_id == source.tenant_id
    assert child[0].source.actor_id == parent[0].source.actor_id == "owner"
    assert child[0].complete
    assert parent[0].complete
    assert child[0].links == (parent[0].trace_id,)
    assert len(child[0].spans) == 3
    assert len(parent[0].spans) == 5
    assert all(span.status == "error" for span in child[0].spans)
    parent_nodes = {span.span_id: span for span in parent[0].spans[1:]}
    for span in child[0].spans:
        assert span.error == parent_nodes[span.span_id].error
        assert span.ended_at == parent_nodes[span.span_id].ended_at == parent[0].spans[0].ended_at


@pytest.mark.parametrize("outcome", ["host_failure", "without_outcome", "pause", "retry", "paused_node", "unstarted"])
def test_unobserved_node_completion_remains_incomplete(outcome: str) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()), actor_id="user")
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    node = workflow_node(source)
    if outcome == "unstarted":
        with recorder.node_run_context(node):
            pass
    else:
        start_node(recorder, node)
    if outcome == "retry":
        recorder.on_event(
            NodeRunRetryEvent(
                id=node.execution_id,
                node_id=node.id,
                node_type=node.node_type,
                node_title=node.title,
                start_at=datetime.now(UTC),
                retry_index=1,
                error="retry",
            )
        )
    elif outcome == "paused_node":
        recorder.on_event(
            NodeRunPauseRequestedEvent(
                id=node.execution_id, node_id=node.id, node_type=node.node_type, reason=SchedulingPause(message="pause")
            )
        )
    if outcome in {"retry", "paused_node", "unstarted"}:
        recorder.on_event(GraphRunFailedEvent(error="engine failed"))
    if outcome == "pause":
        recorder.on_event(GraphRunPausedEvent())
        assert not recorder.finish_workflow_trace()
        assert not submitted
        return
    assert recorder.finish_workflow_trace("host failed" if outcome == "host_failure" else None)
    trace = submitted[0]
    captured = next(span for span in trace.spans if span.node_execution_id == node.execution_id)
    assert not trace.complete
    assert captured.status == "incomplete"
    assert captured.ended_at is None
    reasons = trace.truncation["reasons"]
    assert isinstance(reasons, list)
    assert "unfinished_execution" in reasons


@pytest.mark.parametrize("failure", ["stopped", "engine", "host"])
def test_workflow_entry_propagates_observed_termination_without_inventing_host_outcomes(
    failure: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()), actor_id="user")
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    start_node(recorder, workflow_node(source))
    engine_error = RuntimeError("engine failed")
    entry = object.__new__(WorkflowEntry)
    entry._workflow_trace = recorder
    entry._response_stream_filter = Mock()
    entry.graph_engine = Mock(runtime_state=SimpleNamespace(graph_execution=SimpleNamespace(error=engine_error)))

    def engine_events(*_args: object) -> Generator[EngineEvent, None, None]:
        if failure == "stopped":
            raise GenerateTaskStoppedError()
        if failure == "engine":
            event = GraphRunFailedEvent(error=str(engine_error))
            recorder.on_event(event)
            yield event
            raise engine_error
        raise RuntimeError("host failed")

    monkeypatch.setattr("core.workflow.workflow_entry.iter_dify_graph_engine_events", engine_events)
    list(entry.run())
    root, node = submitted[0].spans
    assert submitted[0].complete is (failure != "host")
    assert node.status == ("incomplete" if failure == "host" else "error")
    if failure == "host":
        assert node.ended_at is None
    else:
        assert node.ended_at == root.ended_at
    assert (
        root.error
        == node.error
        == {"stopped": "Workflow execution stopped", "engine": "engine failed", "host": "host failed"}[failure]
    )


def test_concurrent_tenants_keep_their_terminal_errors_and_execution_identity() -> None:
    sources = [
        TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()), actor_id=f"user-{index}")
        for index in range(2)
    ]
    ready = Barrier(2)

    def run(index: int) -> CompletedTrace:
        source = sources[index]
        submitted: list[CompletedTrace] = []
        recorder = WorkflowTraceRecorder(
            source=source,
            workflow_id="workflow",
            workflow_version="1",
            inputs={"owner": index},
            submit_completed_trace=lambda trace: submitted.append(trace) is None,
        )
        node = workflow_node(source)
        cast(Mock, node).execution_id = "same-execution-id"
        node.run_context[DIFY_RUN_CONTEXT_KEY].user_id = source.actor_id
        start_node(recorder, node)
        ready.wait(timeout=5)
        recorder.on_event(GraphRunAbortedEvent(reason=f"tenant-{index}-stopped"))
        assert recorder.finish_workflow_trace()
        return submitted[0]

    with ThreadPoolExecutor(max_workers=2) as workers:
        traces = list(workers.map(run, range(2)))
    for index, trace in enumerate(traces):
        assert trace.source == sources[index]
        assert all(span.error == f"tenant-{index}-stopped" for span in trace.spans)
        assert all(span.source_app_id == sources[index].app_id for span in trace.spans)
    assert traces[0].trace_id != traces[1].trace_id
    assert traces[0].spans[-1].span_id != traces[1].spans[-1].span_id

    rejected: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=sources[0],
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace: rejected.append(trace) is None,
    )
    start_node(recorder, workflow_node(sources[1]))
    recorder.on_event(GraphRunFailedEvent(error="foreign execution"))
    assert not recorder.finish_workflow_trace()
    assert not rejected


@pytest.mark.parametrize("resume_from", ["retry", "pause"])
def test_restarted_nodes_close_at_the_terminal_event_without_losing_prior_attempt_usage(resume_from: str) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()), actor_id="user")
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    node = workflow_node(source, node_type="llm")
    start_node(recorder, node)
    started = datetime.now(UTC)
    usage = LLMUsage.empty_usage().model_copy(update={"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8})
    if resume_from == "retry":
        recorder.on_event(
            NodeRunRetryEvent(
                id=node.execution_id,
                node_id=node.id,
                node_type=node.node_type,
                node_title=node.title,
                start_at=started,
                retry_index=1,
                error="try again",
                node_run_result=NodeRunResult(llm_usage=usage, inputs={"attempt": 0}),
            )
        )
    else:
        recorder.on_event(
            NodeRunPauseRequestedEvent(
                id=node.execution_id, node_id=node.id, node_type=node.node_type, reason=SchedulingPause(message="pause")
            )
        )
        recorder.on_event(GraphRunPausedEvent())
        checkpoint = recorder.save_pause_state()
        recorder = WorkflowTraceRecorder(
            source=source,
            workflow_id="workflow",
            workflow_version="1",
            inputs={},
            pause_state=checkpoint,
            submit_completed_trace=lambda trace: submitted.append(trace) is None,
        )
        recorder.on_event(GraphRunStartedEvent())
    recorder.on_event(
        NodeRunStartedEvent(
            id=node.execution_id,
            node_id=node.id,
            node_type=node.node_type,
            node_title=node.title,
            start_at=datetime.now(UTC),
            node_run_result=NodeRunResult(inputs={"attempt": 1}),
        )
    )
    recorder.on_event(GraphRunAbortedEvent(reason="stopped after restart"))
    assert recorder.finish_workflow_trace()
    trace = submitted[0]
    root, running, *previous = trace.spans
    assert trace.complete
    assert running.status == "error"
    assert running.inputs == {"attempt": 1}
    assert running.ended_at == root.ended_at
    if resume_from == "retry":
        assert len(previous) == 1
        assert previous[0].error == "try again"
        assert previous[0].usage == usage.model_dump(mode="json")
        assert previous[0].inputs == {"attempt": 0}
