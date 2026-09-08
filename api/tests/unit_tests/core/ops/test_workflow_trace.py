"""Workflow trace identity, retry, pause and isolation checks."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext, InvokeFrom, UserFrom
from core.ops.trace_data import TraceSource
from core.ops.workflow_trace import WorkflowTraceRecorder
from graphon.engine_events import (
    GraphRunAbortedEvent,
    GraphRunPausedEvent,
    GraphRunSucceededEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from graphon.node_events import NodeRunResult


def test_nested_retry_pause_resume_is_owned_and_sealed():
    source = TraceSource(
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        operation_id=str(uuid4()),
        workflow_run_id=str(uuid4()),
        message_id=str(uuid4()),
        conversation_id=str(uuid4()),
        actor_id="original-actor",
        external_trace_id="external-trace",
        session_id="original-session",
    )
    workflow_id = str(uuid4())
    completed = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id=workflow_id,
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace: completed.append(trace) is None,
    )
    started = datetime.now(UTC)

    def node(execution_id, tenant_id=source.tenant_id):
        return SimpleNamespace(
            execution_id=execution_id,
            id="reused-node-id",
            title="Node",
            node_type="llm",
            workflow_id=workflow_id,
            version=lambda: "1",
            run_context={
                DIFY_RUN_CONTEXT_KEY: DifyRunContext(
                    tenant_id=tenant_id,
                    app_id=source.app_id,
                    user_id="user",
                    user_from=UserFrom.ACCOUNT,
                    invoke_from=InvokeFrom.DEBUGGER,
                )
            },
        )

    parent_id, child_id = str(uuid4()), str(uuid4())
    with recorder.node_run_context(node(parent_id)):
        recorder.record_workflow_event(
            NodeRunStartedEvent(
                id=parent_id, node_id="reused-node-id", node_type="llm", node_title="Node", start_at=started
            )
        )
    with recorder.node_run_context(node(child_id), parent_execution_id=parent_id):
        recorder.record_workflow_event(
            NodeRunStartedEvent(
                id=child_id, node_id="reused-node-id", node_type="llm", node_title="Node", start_at=started
            )
        )
        recorder.record_workflow_event(
            NodeRunRetryEvent(
                id=child_id,
                node_id="reused-node-id",
                node_type="llm",
                node_title="Node",
                start_at=started,
                error="retry",
                retry_index=1,
            )
        )
    recorder.record_workflow_event(GraphRunPausedEvent())
    checkpoint = recorder.save_pause_state()
    recorder.record_workflow_event(GraphRunSucceededEvent(outputs={"ignored": True}))
    assert not recorder.finish_workflow_trace()
    assert not completed

    resumed = WorkflowTraceRecorder(
        source=source.model_copy(update={"message_id": None, "conversation_id": None, "session_id": None}),
        workflow_id=workflow_id,
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace: completed.append(trace) is None,
        pause_state=checkpoint,
    )
    outputs = {"answer": ["original"]}
    for execution_id in (child_id, parent_id):
        resumed.record_workflow_event(
            NodeRunSucceededEvent(
                id=execution_id,
                node_id="reused-node-id",
                node_type="llm",
                start_at=started,
                finished_at=datetime.now(UTC),
                node_run_result=NodeRunResult(outputs=outputs),
            )
        )
    outputs["answer"][0] = "mutated"
    resumed.record_workflow_event(GraphRunSucceededEvent(outputs={"done": True}))
    with ThreadPoolExecutor(max_workers=4) as workers:
        results = list(workers.map(lambda _: resumed.finish_workflow_trace(), range(4)))
    assert sum(results) == 1
    trace = completed[0]
    assert trace.complete
    assert trace.source == source
    child = next(span for span in trace.spans if span.node_execution_id == child_id and span.attempt == 1)
    parent = next(span for span in trace.spans if span.node_execution_id == parent_id)
    retry = next(span for span in trace.spans if span.error == "retry")
    assert child.parent_span_id == parent.span_id
    assert retry.parent_span_id == child.span_id
    assert retry.ended_at is None
    assert retry.attributes["metrics_from_parent"] is True
    last_attempt = next(span for span in trace.spans if span.parent_span_id == child.span_id and span.attempt == 1)
    assert last_attempt.outputs == {"answer": ["original"]}
    assert last_attempt.attributes["metrics_from_parent"] is True
    assert len(trace.spans) == 5

    foreign_source = source.model_copy(update={"tenant_id": str(uuid4())})
    with pytest.raises(ValueError, match="owner mismatch"):
        WorkflowTraceRecorder(
            source=foreign_source,
            workflow_id=workflow_id,
            workflow_version="1",
            inputs={},
            submit_completed_trace=lambda _: True,
            pause_state=checkpoint,
        )
    foreign = WorkflowTraceRecorder(
        source=source, workflow_id=workflow_id, workflow_version="1", inputs={}, submit_completed_trace=lambda _: True
    )
    with foreign.node_run_context(node(str(uuid4()), tenant_id=str(uuid4()))):
        pass
    foreign.record_workflow_event(GraphRunAbortedEvent(reason="stop"))
    assert not foreign.finish_workflow_trace()


@pytest.mark.parametrize("include_loop", [False, True])
def test_graphon_hidden_workflow_events_export_an_independent_child(include_loop):
    from functools import partial
    from unittest.mock import MagicMock

    from core.ops.trace_data import TraceProviderSettings
    from core.tools.workflow_as_tool.repository import WorkflowToolSource, WorkflowToolSourceRepository
    from core.workflow.workflow_tool_container_handler import (
        WorkflowToolContainerHandler,
        WorkflowToolNestedContainerHandler,
    )
    from graphon.engine import Engine
    from graphon.engine.container_handler.builtin.loop import LoopContainerHandler
    from graphon.runtime import RuntimeState, VariablePool
    from tests.unit_tests.core.workflow.test_workflow_tool_container import (
        _outer_graph,
        _source_workflow,
        _workflow_tool_node,
    )

    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()))
    child_app_id = str(uuid4())
    child_settings = TraceProviderSettings(
        tenant_id=source.tenant_id, app_id=child_app_id, provider_name="langsmith", config_id=str(uuid4())
    )
    submitted = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="outer-workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace, settings=(): submitted.append((trace, settings)) is None,
        load_provider_settings=lambda _tenant_id, _app_id: (child_settings,),
    )
    state = RuntimeState(workflow_id="outer-workflow", variable_pool=VariablePool(), start_at=1)
    tool, runtime, request = _workflow_tool_node(state, app_id=source.app_id)
    tool.run_context[DIFY_RUN_CONTEXT_KEY].tenant_id = source.tenant_id
    runtime.build_workflow_tool_container_payload.return_value = request.model_copy(
        update={"source_app_id": child_app_id}
    )
    _, workflow = _source_workflow()
    source_graph = workflow.graph_dict
    if include_loop:
        source_graph["nodes"].extend(
            [
                {
                    "id": "source-loop",
                    "data": {
                        "type": "loop",
                        "title": "Loop",
                        "loop_count": 2,
                        "start_node_id": "source-loop-start",
                        "break_conditions": [],
                        "logical_operator": "and",
                    },
                },
                {
                    "id": "source-loop-start",
                    "data": {"type": "loop-start", "title": "Loop start", "loop_id": "source-loop"},
                },
            ]
        )
        source_graph["edges"] = [
            {"id": "start-loop", "source": "source-start", "target": "source-loop"},
            {"id": "loop-end", "source": "source-loop", "target": "source-end"},
        ]
    repository = MagicMock(spec=WorkflowToolSourceRepository)
    repository.get_source.return_value = WorkflowToolSource(
        app_id=child_app_id,
        workflow_id=workflow.id,
        graph_config=source_graph,
        features_dict={},
        environment_variables=[],
        workflow_kind="standard",
    )
    engine = Engine(
        graph=_outer_graph(tool),
        runtime_state=state,
        workers=2,
        container_handler_factories=(
            partial(
                WorkflowToolNestedContainerHandler,
                handler_factory=LoopContainerHandler,
                hidden_event_listener=recorder.record_workflow_event,
                execution_event_listener=recorder.record_workflow_event,
            ),
            partial(
                WorkflowToolContainerHandler,
                source_repository=repository,
                workflow_trace=recorder,
                hidden_event_listener=recorder.record_workflow_event,
            ),
        ),
    )
    engine.add_layer(recorder)
    public_events = list(engine.run())
    recorder.finish_workflow_trace()

    assert isinstance(public_events[-1], GraphRunSucceededEvent)
    assert not any(getattr(event, "node_id", "").startswith("source-") for event in public_events)
    assert len(submitted) == 2
    child_trace, routes = submitted[0]
    parent_trace, _ = submitted[1]
    assert routes == [child_settings]
    assert child_trace.source.app_id == child_app_id
    assert child_trace.source.message_id is None
    assert child_trace.spans[0].parent_span_id is None
    assert len(child_trace.spans) == (6 if include_loop else 3)
    assert len(parent_trace.spans) == (8 if include_loop else 5)
    if include_loop:
        starts = [span for span in child_trace.spans if span.node_id == "source-loop-start"]
        assert len(starts) == 2
        assert starts[0].node_execution_id != starts[1].node_execution_id
    else:
        assert {span.node_id for span in child_trace.spans} == {"tool", "source-start", "source-end"}
    assert parent_trace.complete


def test_pause_destinations_cannot_switch_tenants_and_budget_releases():
    from core.ops.trace_data import TraceProviderSettings

    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()))
    reservations = []
    releases = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={"input": "value"},
        submit_completed_trace=lambda _: True,
        reserve_recording_bytes=lambda tenant_id, byte_count: reservations.append((tenant_id, byte_count)) is None,
        release_recording_bytes=lambda tenant_id, byte_count: releases.append((tenant_id, byte_count)),
    )
    checkpoint = recorder.save_pause_state()
    assert releases == [(source.tenant_id, sum(byte_count for _, byte_count in reservations))]
    checkpoint["provider_settings"] = [
        TraceProviderSettings(
            tenant_id=str(uuid4()), app_id=source.app_id, provider_name="langsmith", config_id=str(uuid4())
        ).model_dump()
    ]
    with pytest.raises(ValueError, match="destination owner mismatch"):
        WorkflowTraceRecorder(
            source=source,
            workflow_id="workflow",
            workflow_version="1",
            inputs={},
            submit_completed_trace=lambda _: True,
            pause_state=checkpoint,
        )


def test_retried_workflow_tool_exports_each_invocation_without_the_other_attempt():
    from core.ops.trace_data import TraceProviderSettings
    from graphon.engine_events import NodeRunFailedEvent

    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()))
    child_app_id, child_workflow_id = str(uuid4()), str(uuid4())
    child_settings = TraceProviderSettings(
        tenant_id=source.tenant_id, app_id=child_app_id, provider_name="langsmith", config_id=str(uuid4())
    )
    submitted = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="outer-workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace, settings=(): submitted.append((trace, settings)) is None,
        load_provider_settings=lambda _tenant_id, _app_id: (child_settings,),
    )
    tool_execution_id = str(uuid4())
    started = datetime.now(UTC)

    def node(execution_id, invocation_id=None):
        return SimpleNamespace(
            execution_id=execution_id,
            id="tool" if invocation_id is None else "child-node",
            title="Tool" if invocation_id is None else "Child node",
            node_type="tool" if invocation_id is None else "code",
            workflow_id="outer-workflow" if invocation_id is None else child_workflow_id,
            version=lambda: "1",
            run_context={
                DIFY_RUN_CONTEXT_KEY: DifyRunContext(
                    tenant_id=source.tenant_id,
                    app_id=source.app_id if invocation_id is None else child_app_id,
                    user_id="user",
                    user_from=UserFrom.ACCOUNT,
                    invoke_from=InvokeFrom.DEBUGGER,
                    workflow_tool_invocation_id=invocation_id,
                )
            },
        )

    with recorder.node_run_context(node(tool_execution_id)):
        recorder.record_workflow_event(
            NodeRunStartedEvent(
                id=tool_execution_id, node_id="tool", node_type="tool", node_title="Tool", start_at=started
            )
        )
    for attempt in range(2):
        invocation_id, execution_id = str(uuid4()), str(uuid4())
        recorder.register_workflow_source(
            tenant_id=source.tenant_id,
            app_id=child_app_id,
            workflow_id=child_workflow_id,
            workflow_version="1",
            invocation_id=invocation_id,
            parent_execution_id=tool_execution_id,
        )
        with recorder.node_run_context(node(execution_id, invocation_id), parent_execution_id=tool_execution_id):
            outcome = NodeRunFailedEvent if attempt == 0 else NodeRunSucceededEvent
            recorder.record_workflow_event(
                outcome(
                    id=execution_id,
                    node_id="child-node",
                    node_type="code",
                    start_at=started,
                    finished_at=datetime.now(UTC),
                    node_run_result=NodeRunResult(outputs={"attempt": attempt}),
                    **({"error": "retry child"} if attempt == 0 else {}),
                )
            )
        if attempt == 0:
            recorder.record_workflow_event(
                NodeRunRetryEvent(
                    id=tool_execution_id,
                    node_id="tool",
                    node_type="tool",
                    node_title="Tool",
                    start_at=started,
                    retry_index=1,
                    error="retry child",
                    node_run_result=NodeRunResult(outputs={"attempt": attempt}),
                )
            )
        else:
            recorder.record_workflow_event(
                NodeRunSucceededEvent(
                    id=tool_execution_id,
                    node_id="tool",
                    node_type="tool",
                    start_at=started,
                    finished_at=datetime.now(UTC),
                    node_run_result=NodeRunResult(outputs={"attempt": attempt}),
                )
            )
        child_trace, routes = submitted[-1]
        assert routes == [child_settings]
        assert len(child_trace.spans) == 2
        assert child_trace.spans[0].outputs == {"attempt": attempt}
        assert child_trace.spans[0].attributes.get("metrics_from_parent") is None
        assert child_trace.spans[1].node_execution_id == execution_id
        assert child_trace.spans[1].outputs == {"attempt": attempt}
        assert child_trace.spans[0].status == ("error" if attempt == 0 else "ok")
    assert len(submitted) == 2
    assert submitted[0][0].trace_id != submitted[1][0].trace_id
    recorder.record_workflow_event(GraphRunSucceededEvent())
    recorder.finish_workflow_trace()
    assert len(submitted) == 3
