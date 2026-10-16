"""Actual response owners; Redis/SQL/provider ports are explicit test boundaries."""

from importlib import import_module, util
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import Mock

import pytest
from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.apps.workflow.app_queue_manager import WorkflowAppQueueManager
from core.app.apps.workflow.generate_task_pipeline import WorkflowAppGenerateTaskPipeline
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueWorkflowSucceededEvent
from core.workflow.system_variables import build_system_variables
from models.account import Account
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
from services.dify_builder.native_testing.http_binding import build_native_http_profile
from services.dify_builder.native_testing.observation_adapters import NativeObservationError, NativeObservationGuard
from services.dify_builder.native_testing.observation_privacy import NativeHttpObservationPolicy
from tests.unit_tests.services.dify_builder.native_testing.test_observation_privacy import NOW, SENTINEL, context

from graphon.runtime import GraphRuntimeState, VariablePool


def domain():
    name = "services.dify_builder.native_testing.observation_stream"
    assert util.find_spec(name) is not None, "native queue projection owner is missing"
    return import_module(name)


@pytest.fixture
def guard():
    return NativeObservationGuard(
        policy=NativeHttpObservationPolicy.qualify(context=context(), profile=build_native_http_profile()),
        on_failure=lambda: None,
    )


def entity(**kwargs) -> Any:
    """Structural constructor-refusal fixture; no native provenance claim."""
    return SimpleNamespace(
        task_id="task",
        app_config=SimpleNamespace(app_id="app", tenant_id="tenant"),
        invoke_from=InvokeFrom.DEBUGGER,
        files=[],
        inputs={SENTINEL: SENTINEL},
        workflow_execution_id="run",
        call_depth=0,
        native_test_required=True,
        native_test_ref=None,
        trace_manager=None,
        **kwargs,
    )


def account():
    user = Account(name=SENTINEL, email=SENTINEL + "@example.com")
    user.id = "actor"
    return user


def test_domain_projects_and_retains_independent_canonical_markers(guard):
    raw = QueueWorkflowSucceededEvent(outputs={SENTINEL: SENTINEL})
    first = domain().project_native_queue_event(guard=guard, event=raw)
    second = domain().project_native_queue_event(guard=guard, event=first)
    assert first is not second
    assert first.outputs is not second.outputs
    assert first.outputs == second.outputs
    assert SENTINEL not in first.model_dump_json()
    assert raw.outputs == {SENTINEL: SENTINEL}


def test_marked_converter_requires_guard_before_input_conversion(monkeypatch):
    touch = Mock(side_effect=AssertionError("raw input conversion"))
    monkeypatch.setattr("core.app.apps.common.workflow_response_converter.WorkflowEntry.handle_special_values", touch)
    with pytest.raises(NativeObservationError, match="native_observation_failed"):
        WorkflowResponseConverter(application_generate_entity=entity(), user=account(), system_variables=[])
    touch.assert_not_called()


def test_marked_pipeline_requires_guard_before_any_initialization():
    with pytest.raises(NativeObservationError, match="native_observation_failed"):
        WorkflowAppGenerateTaskPipeline(
            application_generate_entity=entity(),
            workflow=cast(Any, None),
            queue_manager=cast(Any, None),
            user=cast(Any, None),
            stream=True,
            draft_var_saver_factory=cast(Any, None),
        )


def test_queue_projects_before_base_model_dump_and_direct_publish(guard, monkeypatch):
    monkeypatch.setattr(
        "core.app.apps.base_app_queue_manager.redis_client", Mock()
    )  # Redis ownership/cache boundary only.
    manager = WorkflowAppQueueManager("task", "actor", InvokeFrom.DEBUGGER, "workflow", native_observation=guard)
    raw = QueueWorkflowSucceededEvent(outputs={SENTINEL: SENTINEL})
    original = QueueWorkflowSucceededEvent.model_dump

    def checked(event, *args, **kwargs):
        assert event is not raw, "raw event reached model_dump"
        return original(event, *args, **kwargs)

    monkeypatch.setattr(QueueWorkflowSucceededEvent, "model_dump", checked)
    manager.publish(raw, PublishFrom.APPLICATION_MANAGER)
    message = manager._q.get_nowait()
    assert message is not None
    assert SENTINEL not in message.model_dump_json()
    manager._q.get_nowait()  # terminal sentinel
    manager._publish(raw, PublishFrom.APPLICATION_MANAGER)
    direct = manager._q.get_nowait()
    assert direct is not None
    assert SENTINEL not in direct.model_dump_json()


def converter(guard) -> Any:
    return WorkflowResponseConverter(
        application_generate_entity=entity(),
        user=account(),
        system_variables=build_system_variables(
            files=[], user_id="actor", app_id="app", workflow_id="workflow", workflow_execution_id="run"
        ),
        native_observation=guard,
    )


def test_native_finish_reads_live_outputs_without_converter_or_file_routes(guard, monkeypatch):
    from graphon.entities import WorkflowStartReason
    from graphon.enums import WorkflowExecutionStatus

    c = converter(guard)
    c.workflow_start_to_stream_response(
        task_id="task", workflow_run_id="run", workflow_id="workflow", reason=WorkflowStartReason.INITIAL
    )
    state = GraphRuntimeState(variable_pool=VariablePool(), start_at=0.0)
    state.set_output(SENTINEL, SENTINEL)
    tripwire = Mock(side_effect=AssertionError("raw encoding/file/truncation"))
    monkeypatch.setattr("core.app.apps.common.workflow_response_converter.WorkflowRuntimeTypeConverter", tripwire)
    monkeypatch.setattr(c, "fetch_files_from_node_outputs", tripwire)
    monkeypatch.setattr(c._truncator, "truncate_variable_mapping", tripwire)
    for status in [
        WorkflowExecutionStatus.SUCCEEDED,
        WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
        WorkflowExecutionStatus.FAILED,
        WorkflowExecutionStatus.STOPPED,
    ]:
        response = c.workflow_finish_to_stream_response(
            task_id="task",
            workflow_id="workflow",
            status=status,
            graph_runtime_state=state,
            error=SENTINEL,
            exceptions_count=2,
        )
        assert SENTINEL not in response.model_dump_json()
        assert response.data.status is status
        assert response.data.created_by == {"id": "actor"}
        assert response.data.exceptions_count == 2
        assert not response.data.files
    assert state.outputs == {SENTINEL: SENTINEL}
    tripwire.assert_not_called()


@pytest.mark.parametrize(
    "bad",
    [
        {"redacted": True, "shape": {"type": "string", "length": -1}},
        {"redacted": True, "shape": {"type": "null"}, "private": SENTINEL},
        {"redacted": True, "shape": {"type": SENTINEL}},
    ],
)
def test_marker_is_content_validation_not_caller_authority(guard, bad):
    result = domain().observed_values(guard=guard, values=bad)
    assert result != bad
    assert SENTINEL not in str(result)


class Unrenderable:
    def __str__(self):
        raise AssertionError("rendered private object")

    __repr__ = __str__


def test_unknown_object_fails_without_rendering_and_latches(guard):
    with pytest.raises(NativeObservationError, match="native_observation_failed"):
        domain().project_native_queue_event(
            guard=guard, event=QueueWorkflowSucceededEvent(outputs={"x": Unrenderable()})
        )
    assert guard.failed


@pytest.mark.parametrize("kind", ["start", "success", "failed", "exception", "retry", "text", "pause", "stop", "error"])
def test_supported_real_queue_dtos_are_fresh_and_safe(guard, kind):
    from core.app.entities import queue_entities as q

    from graphon.entities.pause_reason import SchedulingPause
    from graphon.enums import BuiltinNodeTypes

    base = {
        "node_execution_id": "execution",
        "node_id": "http",
        "node_type": BuiltinNodeTypes.HTTP_REQUEST,
        "start_at": NOW.replace(tzinfo=None),
    }
    started = dict(**base, node_title=SENTINEL, provider_type=SENTINEL, provider_id=SENTINEL)
    events = {
        "start": lambda: q.QueueNodeStartedEvent(**started),
        "success": lambda: q.QueueNodeSucceededEvent(**base, outputs={SENTINEL: SENTINEL}),
        "failed": lambda: q.QueueNodeFailedEvent(**base, error=SENTINEL),
        "exception": lambda: q.QueueNodeExceptionEvent(**base, error=SENTINEL),
        "retry": lambda: q.QueueNodeRetryEvent(
            **started, error=SENTINEL, retry_index=2, process_data={SENTINEL: SENTINEL}
        ),
        "text": lambda: q.QueueTextChunkEvent(text=SENTINEL, from_variable_selector=["http", SENTINEL]),
        "pause": lambda: q.QueueWorkflowPausedEvent(
            reasons=[SchedulingPause(message=SENTINEL)], outputs={SENTINEL: SENTINEL}, paused_nodes=["http"]
        ),
        "stop": lambda: q.QueueStopEvent(stopped_by=q.QueueStopEvent.StopBy.USER_MANUAL, reason=SENTINEL),
        "error": lambda: q.QueueErrorEvent(error=RuntimeError(SENTINEL)),
    }
    event = events[kind]()
    result = domain().project_native_queue_event(guard=guard, event=event)
    assert result is not event
    assert type(result) is type(event)
    assert SENTINEL not in result.model_dump_json()
    if kind == "retry":
        assert isinstance(result, q.QueueNodeRetryEvent)
        assert result.retry_index == 2


def test_wrong_node_type_and_unqualified_hitl_fail_before_projection(guard):
    from core.app.entities.queue_entities import QueueNodeStartedEvent

    from graphon.enums import BuiltinNodeTypes

    event = QueueNodeStartedEvent(
        node_execution_id="e",
        node_id="http",
        node_type=BuiltinNodeTypes.TOOL,
        node_title=SENTINEL,
        start_at=NOW.replace(tzinfo=None),
        provider_type="",
        provider_id="",
    )
    with pytest.raises(NativeObservationError):
        domain().project_native_queue_event(guard=guard, event=event)


def make_pipeline(guard, monkeypatch, **updates) -> tuple[Any, Any, Mock]:
    from tests.unit_tests.core.app.apps.workflow.test_generate_task_pipeline_core import _make_pipeline

    ordinary = _make_pipeline()
    e = ordinary._application_generate_entity.model_copy(
        update={"native_test_required": True, "invoke_from": InvokeFrom.DEBUGGER, **updates}
    )
    monkeypatch.setattr("core.app.apps.base_app_queue_manager.redis_client", Mock())
    queue = WorkflowAppQueueManager("task", "actor", InvokeFrom.DEBUGGER, "workflow", native_observation=guard)
    saver = Mock(side_effect=AssertionError("unknown draft factory must never be invoked"))
    pipeline = WorkflowAppGenerateTaskPipeline(
        application_generate_entity=e,
        workflow=ordinary._workflow,
        queue_manager=queue,
        user=account(),
        stream=True,
        draft_var_saver_factory=saver,
        native_observation=guard,
    )
    return pipeline, queue, saver


def test_pipeline_projects_internal_events_and_noops_draft_saver(guard, monkeypatch):
    from core.app.entities.queue_entities import QueueNodeSucceededEvent

    from graphon.enums import BuiltinNodeTypes

    p, q, saver = make_pipeline(guard, monkeypatch)
    event = QueueNodeSucceededEvent(
        node_execution_id="e",
        node_id="http",
        node_type=BuiltinNodeTypes.HTTP_REQUEST,
        start_at=NOW.replace(tzinfo=None),
        outputs={SENTINEL: SENTINEL},
    )
    p._workflow_execution_id = "run"
    p._workflow_response_converter._workflow_execution_id = "run"
    replies = list(p._dispatch_event(event))
    assert len(replies) == 1
    assert SENTINEL not in replies[0].model_dump_json()
    saver.assert_not_called()
    assert p._workflow_response_converter._native_observation is guard
    assert q.native_observation is guard
    live = GraphRuntimeState(variable_pool=VariablePool(), start_at=0)
    q.graph_runtime_state = live
    assert q.graph_runtime_state is live


def test_pipeline_refuses_tts_trace_and_files_before_actions(guard, monkeypatch):
    p, q, saver = make_pipeline(guard, monkeypatch)
    tts = Mock(side_effect=AssertionError("TTS must not initialize"))
    monkeypatch.setattr("core.app.apps.workflow.generate_task_pipeline.AppGeneratorTTSPublisher", tts)
    p._workflow_features_dict = {"text_to_speech": {"enabled": True, "autoPlay": "enabled"}}
    with pytest.raises(NativeObservationError):
        list(p._wrapper_process_stream_response())
    tts.assert_not_called()


def test_pause_live_fallback_is_safe_without_hitl_resolution(guard, monkeypatch):
    from core.app.entities.queue_entities import QueueWorkflowPausedEvent

    from graphon.entities import WorkflowStartReason
    from graphon.entities.pause_reason import SchedulingPause

    c = converter(guard)
    c.workflow_start_to_stream_response(
        task_id="task", workflow_run_id="run", workflow_id="workflow", reason=WorkflowStartReason.INITIAL
    )
    state = GraphRuntimeState(variable_pool=VariablePool(), start_at=0)
    state.set_output(SENTINEL, SENTINEL)
    trip = Mock(side_effect=AssertionError("HITL resolution"))
    monkeypatch.setattr(
        "core.app.apps.common.workflow_response_converter.resolve_human_input_pause_reason_inputs", trip
    )
    r = c.workflow_pause_to_stream_response(
        event=QueueWorkflowPausedEvent(reasons=[SchedulingPause(message=SENTINEL)], paused_nodes=["http"]),
        task_id="task",
        graph_runtime_state=state,
    )
    assert len(r) == 1
    assert SENTINEL not in r[0].model_dump_json()
    assert r[0].data.outputs["redacted"] is True
    assert r[0].data.outputs["shape"]["fields"] == 1
    explicit = c.workflow_pause_to_stream_response(
        event=QueueWorkflowPausedEvent(outputs={"first": SENTINEL, "second": SENTINEL}, paused_nodes=["http"]),
        task_id="task",
        graph_runtime_state=state,
    )
    assert explicit[0].data.outputs["shape"]["fields"] == 2
    trip.assert_not_called()


def test_direct_native_error_handler_never_passes_raw_error_to_base(guard, monkeypatch):
    from core.app.entities.queue_entities import QueueErrorEvent

    p, q, saver = make_pipeline(guard, monkeypatch)
    original = p._base_task_pipeline.handle_error

    def checked(*, event):
        assert event.error == "native_execution_error"
        return original(event=event)

    monkeypatch.setattr(p._base_task_pipeline, "handle_error", checked)
    r = list(p._handle_error_event(QueueErrorEvent(error=RuntimeError(SENTINEL))))
    assert len(r) == 1
    assert str(r[0].err) == "native_execution_error"


def test_direct_native_text_handler_rejects_tts_before_publish(guard, monkeypatch):
    from core.app.entities.queue_entities import QueueTextChunkEvent

    p, q, saver = make_pipeline(guard, monkeypatch)
    tts = Mock()
    with pytest.raises(NativeObservationError):
        list(p._handle_text_chunk_event(QueueTextChunkEvent(text=SENTINEL), tts_publisher=tts, queue_message=object()))
    tts.publish.assert_not_called()


@pytest.mark.parametrize("kind", ["iteration", "loop"])
def test_real_container_queue_and_converter_preserve_counts_without_values(kind):
    from core.app.entities import queue_entities as q
    from tests.unit_tests.services.dify_builder.native_testing.test_observation_privacy import container_context

    from graphon.entities import WorkflowStartReason
    from graphon.enums import BuiltinNodeTypes

    guard = NativeObservationGuard(
        policy=NativeHttpObservationPolicy.qualify(
            context=container_context(kind), profile=build_native_http_profile()
        ),
        on_failure=lambda: None,
    )
    prefix = "Iteration" if kind == "iteration" else "Loop"
    base = {
        "node_execution_id": "container-execution",
        "node_id": "container",
        "node_type": BuiltinNodeTypes.ITERATION if kind == "iteration" else BuiltinNodeTypes.LOOP,
        "node_title": SENTINEL,
        "node_run_index": 2,
    }
    c = converter(guard)
    c.workflow_start_to_stream_response(
        task_id="task", workflow_run_id="run", workflow_id="workflow", reason=WorkflowStartReason.INITIAL
    )
    events = [
        getattr(q, "Queue" + prefix + "StartEvent")(
            **base, start_at=NOW.replace(tzinfo=None), inputs={SENTINEL: SENTINEL}, metadata={kind + "_length": 3}
        ),
        getattr(q, "Queue" + prefix + "NextEvent")(**base, index=1, output=SENTINEL),
        getattr(q, "Queue" + prefix + "CompletedEvent")(
            **base,
            start_at=NOW.replace(tzinfo=None),
            steps=4,
            inputs={SENTINEL: SENTINEL},
            outputs={SENTINEL: SENTINEL},
        ),
    ]
    response = None
    for event, method in zip(events, ["start", "next", "completed"], strict=True):
        projected = domain().project_native_queue_event(guard=guard, event=event)
        assert projected == domain().project_native_queue_event(guard=guard, event=projected)
        response = getattr(c, "workflow_" + kind + "_" + method + "_to_stream_response")(
            task_id="task", workflow_execution_id="run", event=event
        )
        assert SENTINEL not in response.model_dump_json()
    assert response is not None
    assert response.data.steps == 4


def test_retry_history_remains_safe_and_idempotent_in_queue_and_converter(guard):
    from core.app.entities.queue_entities import QueueNodeStartedEvent, QueueNodeSucceededEvent

    from graphon.entities import WorkflowStartReason
    from graphon.enums import BuiltinNodeTypes

    history = {
        "retry_index": 1,
        "inputs": {SENTINEL: SENTINEL},
        "process_data": {SENTINEL: SENTINEL},
        "outputs": {SENTINEL: SENTINEL},
        "error": SENTINEL,
        "elapsed_time": 0.2,
        "execution_metadata": {"total_tokens": 3},
        "created_at": 1,
        "finished_at": 2,
    }
    event = QueueNodeSucceededEvent(
        node_execution_id="e",
        node_id="http",
        node_type=BuiltinNodeTypes.HTTP_REQUEST,
        start_at=NOW.replace(tzinfo=None),
        process_data={"__dify_retry_history": [history]},
    )
    first = domain().project_native_queue_event(guard=guard, event=event)
    second = domain().project_native_queue_event(guard=guard, event=first)
    assert first == second
    assert first.process_data is not second.process_data
    c = converter(guard)
    c.workflow_start_to_stream_response(
        task_id="task", workflow_run_id="run", workflow_id="workflow", reason=WorkflowStartReason.INITIAL
    )
    c.workflow_node_start_to_stream_response(
        task_id="task",
        event=QueueNodeStartedEvent(
            node_execution_id="e",
            node_id="http",
            node_type=BuiltinNodeTypes.HTTP_REQUEST,
            node_title=SENTINEL,
            start_at=NOW.replace(tzinfo=None),
            provider_type="",
            provider_id="",
        ),
    )
    result = c.workflow_node_finish_to_stream_response(task_id="task", event=first)
    assert result.data.process_data["__dify_retry_history"][0]["retry_index"] == 1
    assert SENTINEL not in result.model_dump_json()


def test_live_output_read_failure_is_latched_without_raw_exception(guard):
    from graphon.entities import WorkflowStartReason
    from graphon.enums import WorkflowExecutionStatus

    class PrivateCopy:
        def __deepcopy__(self, memo):
            raise RuntimeError(SENTINEL)

    state = GraphRuntimeState(variable_pool=VariablePool(), start_at=0)
    state._outputs["x"] = PrivateCopy()  # Fault injection at actual live snapshot copy boundary.
    c = converter(guard)
    c.workflow_start_to_stream_response(
        task_id="task", workflow_run_id="run", workflow_id="workflow", reason=WorkflowStartReason.INITIAL
    )
    with pytest.raises(NativeObservationError, match="native_observation_failed"):
        c.workflow_finish_to_stream_response(
            task_id="task", workflow_id="workflow", status=WorkflowExecutionStatus.SUCCEEDED, graph_runtime_state=state
        )
    assert guard.failed


@pytest.mark.parametrize("field", ["files", "trace_manager"])
def test_native_pipeline_refuses_unqualified_setup_before_base(guard, monkeypatch, field):
    with pytest.raises(NativeObservationError):
        make_pipeline(guard, monkeypatch, **{field: [object()] if field == "files" else object()})


def test_native_pipeline_refuses_different_queue_guard(guard, monkeypatch):
    p, q, saver = make_pipeline(guard, monkeypatch)
    with pytest.raises(NativeObservationError):
        WorkflowAppGenerateTaskPipeline(
            application_generate_entity=p._application_generate_entity,
            workflow=p._workflow,
            queue_manager=q,
            user=account(),
            stream=True,
            draft_var_saver_factory=saver,
            native_observation=NativeObservationGuard(
                policy=NativeHttpObservationPolicy.qualify(context=context(), profile=build_native_http_profile()),
                on_failure=lambda: None,
            ),
        )


def test_unqualified_queue_classes_refuse_without_serializing(guard):
    from core.app.entities.queue_entities import QueueAgentLogEvent

    e = QueueAgentLogEvent(
        id="log", label=SENTINEL, node_execution_id="e", status="x", data={"x": Unrenderable()}, node_id="http"
    )
    with pytest.raises(NativeObservationError):
        domain().project_native_queue_event(guard=guard, event=e)


def test_pipeline_listen_projects_raw_internal_error_before_base(guard, monkeypatch):
    from core.app.entities.queue_entities import QueueErrorEvent, WorkflowQueueMessage

    p, q, saver = make_pipeline(guard, monkeypatch)
    monkeypatch.setattr(
        q,
        "listen",
        lambda: iter(
            [
                WorkflowQueueMessage(
                    task_id="task", app_mode="workflow", event=QueueErrorEvent(error=RuntimeError(SENTINEL))
                )
            ]
        ),
    )
    result = list(p._process_stream_response())
    assert len(result) == 1
    assert str(result[0].err) == "native_execution_error"
    saver.assert_not_called()


def test_queue_unknown_value_refuses_before_base_serializer(guard, monkeypatch):
    monkeypatch.setattr("core.app.apps.base_app_queue_manager.redis_client", Mock())
    q = WorkflowAppQueueManager("task", "actor", InvokeFrom.DEBUGGER, "workflow", native_observation=guard)
    trip = Mock(side_effect=AssertionError("raw model_dump"))
    monkeypatch.setattr(QueueWorkflowSucceededEvent, "model_dump", trip)
    with pytest.raises(NativeObservationError):
        q.publish(QueueWorkflowSucceededEvent(outputs={"x": Unrenderable()}), PublishFrom.APPLICATION_MANAGER)
    assert q._q.empty()
    trip.assert_not_called()


@pytest.mark.parametrize("bad", [None, object()])
def test_marked_converter_wrong_guard_refuses_before_inputs(bad):
    with pytest.raises(NativeObservationError):
        WorkflowResponseConverter(
            application_generate_entity=entity(), user=account(), system_variables=[], native_observation=bad
        )


def test_native_no_hitl_or_history_resume(guard):
    from core.app.entities.queue_entities import QueueWorkflowPausedEvent, QueueWorkflowStartedEvent
    from core.workflow.nodes.human_input.pause_reason import HumanInputRequired

    from graphon.entities import WorkflowStartReason

    with pytest.raises(NativeObservationError):
        domain().project_native_queue_event(
            guard=guard, event=QueueWorkflowStartedEvent(reason=WorkflowStartReason.RESUMPTION)
        )
    # App queue HITL is a different actual DTO from Graphon HitlRequired.
    hitl_guard = NativeObservationGuard(policy=guard._policy, on_failure=lambda: None)
    with pytest.raises(NativeObservationError):
        domain().project_native_queue_event(
            guard=hitl_guard,
            event=QueueWorkflowPausedEvent(
                reasons=[HumanInputRequired(form_id="form", form_content=SENTINEL, node_id="http", node_title=SENTINEL)]
            ),
        )


@pytest.mark.parametrize("route", ["projector", "publish", "direct", "converter"])
@pytest.mark.parametrize("supplied_host", [None, SimpleNamespace()])
def test_resumption_requires_actual_host_not_a_caller_port(guard, monkeypatch, route, supplied_host):
    from core.app.entities.queue_entities import QueueWorkflowStartedEvent

    from graphon.entities import WorkflowStartReason

    monkeypatch.setattr("core.app.apps.base_app_queue_manager.redis_client", Mock())
    event = QueueWorkflowStartedEvent(reason=WorkflowStartReason.RESUMPTION)
    if supplied_host is not None and route != "projector":

        def construct():
            if route == "converter":
                return WorkflowResponseConverter(
                    application_generate_entity=entity(),
                    user=account(),
                    system_variables=[],
                    native_observation=guard,
                    native_host=supplied_host,
                )
            return WorkflowAppQueueManager(
                "task", "actor", InvokeFrom.DEBUGGER, "workflow", native_observation=guard, native_host=supplied_host
            )

        with pytest.raises(BuilderExecutionPolicyError, match="native_resume_owner_mismatch"):
            construct()
        return
    queue = None

    def project():
        nonlocal queue
        if route == "projector":
            return domain().project_native_queue_event(guard=guard, event=event, native_host=supplied_host)
        if route == "converter":
            return converter(guard).workflow_start_to_stream_response(
                task_id="task", workflow_run_id="run", workflow_id="workflow", reason=WorkflowStartReason.RESUMPTION
            )
        queue = WorkflowAppQueueManager("task", "actor", InvokeFrom.DEBUGGER, "workflow", native_observation=guard)
        if route == "publish":
            return queue.publish(event, PublishFrom.APPLICATION_MANAGER)
        return queue._publish(event, PublishFrom.APPLICATION_MANAGER)

    with pytest.raises(NativeObservationError, match="native_observation_failed"):
        project()
    if queue is not None:
        assert queue._q.empty()
    assert guard.failed


@pytest.mark.parametrize("price", ["0", "1", "NaN", "Infinity"])
def test_generic_container_decimal_metadata_stays_refused_without_actual_host(price):
    from decimal import Decimal

    from core.app.entities.queue_entities import QueueLoopCompletedEvent
    from tests.unit_tests.services.dify_builder.native_testing.test_observation_privacy import container_context

    guard = NativeObservationGuard(
        policy=NativeHttpObservationPolicy.qualify(
            context=container_context("loop"), profile=build_native_http_profile()
        ),
        on_failure=lambda: None,
    )
    event = QueueLoopCompletedEvent(
        node_execution_id="container-execution",
        node_id="container",
        node_type="loop",
        node_title="loop",
        node_run_index=1,
        start_at=NOW.replace(tzinfo=None),
        metadata={"total_price": Decimal(price)},
    )
    metadata = event.metadata
    with pytest.raises(NativeObservationError, match="native_observation_failed"):
        domain().project_native_queue_event(guard=guard, event=event)
    assert event.metadata is metadata
    assert type(event.metadata["total_price"]) is Decimal
    assert guard.failed
