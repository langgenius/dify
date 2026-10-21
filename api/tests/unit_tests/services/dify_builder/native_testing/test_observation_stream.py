"""Actual response owners; Redis/SQL/provider ports are explicit test boundaries."""

from importlib import import_module, util
from typing import Protocol, cast

import pytest
from redis import Redis

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import QueueWorkflowSucceededEvent, WorkflowQueueMessage
from core.app.entities.task_entities import ErrorStreamResponse, WorkflowPauseStreamResponse
from core.workflow.system_variables import build_system_variables
from graphon.runtime import RuntimeState, VariablePool
from models.account import Account
from models.model import AppMode
from models.workflow import Workflow
from repositories.entities.workflow_execution import WorkflowExecutionTiming
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from services.dify_builder.native_testing.http_binding import build_native_http_profile
from services.dify_builder.native_testing.observation_adapters import NativeObservationError, NativeObservationGuard
from services.dify_builder.native_testing.observation_privacy import NativeHttpObservationPolicy
from services.workflow_runtime.response_converter import WorkflowResponseConverter
from services.workflow_runtime.workflow_pipeline import WorkflowAppGenerateTaskPipeline
from services.workflow_runtime.workflow_queue import WorkflowAppQueueManager
from tests.unit_tests.services.dify_builder.native_testing.test_observation_privacy import NOW, SENTINEL, context


class _QueueWithRuntimeState(Protocol):
    runtime_state: RuntimeState


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


def entity() -> WorkflowAppGenerateEntity:
    """Actual marked DTO with no acquired native host authority."""
    return WorkflowAppGenerateEntity(
        task_id="task",
        user_id="actor",
        stream=True,
        app_config=WorkflowUIBasedAppConfig(
            app_id="app", tenant_id="tenant", workflow_id="workflow", app_mode=AppMode.WORKFLOW
        ),
        invoke_from=InvokeFrom.DEBUGGER,
        files=[],
        inputs={SENTINEL: SENTINEL},
        workflow_execution_id="run",
        workflow_execution_timing=WorkflowExecutionTiming(),
        call_depth=0,
        native_test_required=True,
        native_test_ref=None,
        trace_manager=None,
    )


def bind_queue_cache(monkeypatch):
    """Use the actual Redis client with explicit cache command boundaries."""
    client = Redis()
    monkeypatch.setattr(client, "setex", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(client, "get", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(client, "delete", lambda *_args, **_kwargs: 0)
    monkeypatch.setattr("core.app.apps.base_app_queue_manager.redis_client", client)


class RejectDraftSaverFactory:
    def __init__(self):
        self.calls = []

    def __call__(self, app_id, node_id, node_type, node_execution_id, enclosing_node_id=None):
        self.calls.append((app_id, node_id, node_type, node_execution_id, enclosing_node_id))
        raise AssertionError("unknown draft factory must never be invoked")


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
    touch_calls = []

    def touch(*args, **kwargs):
        touch_calls.append((args, kwargs))
        raise AssertionError("raw input conversion")

    monkeypatch.setattr("services.workflow_runtime.response_converter.WorkflowEntry.handle_special_values", touch)
    with pytest.raises(NativeObservationError, match="native_observation_failed"):
        WorkflowResponseConverter(application_generate_entity=entity(), user=account(), system_variables=[])
    assert touch_calls == []


def test_marked_pipeline_requires_guard_before_any_initialization():
    with pytest.raises(NativeObservationError, match="native_observation_failed"):
        WorkflowAppGenerateTaskPipeline(
            application_generate_entity=entity(),
            workflow=cast(Workflow, None),
            queue_manager=cast(AppQueueManager, None),
            user=cast(Account, None),
            stream=True,
            draft_var_saver_factory=cast(DraftVariableSaverFactory, None),
        )


def test_queue_projects_before_base_model_dump_and_direct_publish(guard, monkeypatch):
    bind_queue_cache(monkeypatch)
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


def converter(guard) -> WorkflowResponseConverter:
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
    state = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0.0)
    state.set_output(SENTINEL, SENTINEL)
    tripwire_calls = []

    def tripwire(*args, **kwargs):
        tripwire_calls.append((args, kwargs))
        raise AssertionError("raw encoding/file/truncation")

    monkeypatch.setattr("services.workflow_runtime.response_converter.WorkflowRuntimeTypeConverter", tripwire)
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
    assert tripwire_calls == []


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


def make_pipeline(
    guard, monkeypatch, **updates
) -> tuple[WorkflowAppGenerateTaskPipeline, WorkflowAppQueueManager, RejectDraftSaverFactory]:
    from tests.unit_tests.core.app.apps.workflow.test_generate_task_pipeline_core import _make_pipeline

    ordinary = _make_pipeline()
    e = ordinary._application_generate_entity.model_copy(
        update={"native_test_required": True, "invoke_from": InvokeFrom.DEBUGGER, **updates}
    )
    bind_queue_cache(monkeypatch)
    queue = WorkflowAppQueueManager("task", "actor", InvokeFrom.DEBUGGER, "workflow", native_observation=guard)
    saver = RejectDraftSaverFactory()
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
    assert saver.calls == []
    assert p._workflow_response_converter._native_observation is guard
    assert q.native_observation is guard
    live = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0)
    cast(_QueueWithRuntimeState, q).runtime_state = live
    assert cast(_QueueWithRuntimeState, q).runtime_state is live


def test_pipeline_refuses_tts_trace_and_files_before_actions(guard, monkeypatch):
    p, q, saver = make_pipeline(guard, monkeypatch)
    tts_calls = []

    def tts(*args, **kwargs):
        tts_calls.append((args, kwargs))
        raise AssertionError("TTS must not initialize")

    monkeypatch.setattr("services.workflow_runtime.workflow_pipeline.AppGeneratorTTSPublisher", tts)
    p._workflow_features_dict = {"text_to_speech": {"enabled": True, "autoPlay": "enabled"}}
    with pytest.raises(NativeObservationError):
        list(p._wrapper_process_stream_response())
    assert tts_calls == []


def test_pause_live_fallback_is_safe_without_hitl_resolution(guard, monkeypatch):
    from core.app.entities.queue_entities import QueueWorkflowPausedEvent
    from graphon.entities import WorkflowStartReason
    from graphon.entities.pause_reason import SchedulingPause

    c = converter(guard)
    c.workflow_start_to_stream_response(
        task_id="task", workflow_run_id="run", workflow_id="workflow", reason=WorkflowStartReason.INITIAL
    )
    state = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0)
    state.set_output(SENTINEL, SENTINEL)
    trip_calls = []

    def trip(*args, **kwargs):
        trip_calls.append((args, kwargs))
        raise AssertionError("HITL resolution")

    monkeypatch.setattr("services.workflow_runtime.response_converter.resolve_human_input_pause_reason_inputs", trip)
    r = c.workflow_pause_to_stream_response(
        event=QueueWorkflowPausedEvent(reasons=[SchedulingPause(message=SENTINEL)], paused_nodes=["http"]),
        task_id="task",
        graph_runtime_state=state,
    )
    assert len(r) == 1
    assert SENTINEL not in r[0].model_dump_json()
    assert isinstance(r[0], WorkflowPauseStreamResponse)
    assert r[0].data.outputs["redacted"] is True
    assert r[0].data.outputs["shape"]["fields"] == 1
    explicit = c.workflow_pause_to_stream_response(
        event=QueueWorkflowPausedEvent(outputs={"first": SENTINEL, "second": SENTINEL}, paused_nodes=["http"]),
        task_id="task",
        graph_runtime_state=state,
    )
    assert isinstance(explicit[0], WorkflowPauseStreamResponse)
    assert explicit[0].data.outputs["shape"]["fields"] == 2
    assert trip_calls == []


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

    class RejectedTTSPublisher:
        def __init__(self):
            self.published = []

        def publish(self, *args, **kwargs):
            self.published.append((args, kwargs))
            raise AssertionError("native text reached TTS")

    tts = RejectedTTSPublisher()
    with pytest.raises(NativeObservationError):
        list(
            p._handle_text_chunk_event(
                QueueTextChunkEvent(text=SENTINEL),
                tts_publisher=tts,
                queue_message=cast(WorkflowQueueMessage, object()),
            )
        )
    assert tts.published == []


@pytest.mark.parametrize("kind", ["iteration", "loop"])
def test_real_container_queue_and_converter_preserve_counts_without_values(kind):
    from core.app.entities import queue_entities as q
    from graphon.entities import WorkflowStartReason
    from graphon.enums import BuiltinNodeTypes
    from tests.unit_tests.services.dify_builder.native_testing.test_observation_privacy import container_context

    guard = NativeObservationGuard(
        policy=NativeHttpObservationPolicy.qualify(
            context=container_context(kind), profile=build_native_http_profile()
        ),
        on_failure=lambda: None,
    )
    start_type, next_type, completed_type = (
        (q.QueueIterationStartEvent, q.QueueIterationNextEvent, q.QueueIterationCompletedEvent)
        if kind == "iteration"
        else (q.QueueLoopStartEvent, q.QueueLoopNextEvent, q.QueueLoopCompletedEvent)
    )
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
        start_type(
            **base, start_at=NOW.replace(tzinfo=None), inputs={SENTINEL: SENTINEL}, metadata={kind + "_length": 3}
        ),
        next_type(**base, index=1, output=SENTINEL),
        completed_type(
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
        response = {
            "iteration": {
                "start": c.workflow_iteration_start_to_stream_response,
                "next": c.workflow_iteration_next_to_stream_response,
                "completed": c.workflow_iteration_completed_to_stream_response,
            },
            "loop": {
                "start": c.workflow_loop_start_to_stream_response,
                "next": c.workflow_loop_next_to_stream_response,
                "completed": c.workflow_loop_completed_to_stream_response,
            },
        }[kind][method](task_id="task", workflow_execution_id="run", event=event)
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
    assert result is not None
    assert result.data.process_data is not None
    assert result.data.process_data["__dify_retry_history"][0]["retry_index"] == 1
    assert SENTINEL not in result.model_dump_json()


def test_live_output_read_failure_is_latched_without_raw_exception(guard):
    from graphon.entities import WorkflowStartReason
    from graphon.enums import WorkflowExecutionStatus

    class PrivateCopy:
        def __deepcopy__(self, memo):
            raise RuntimeError(SENTINEL)

    state = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0)
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
    assert isinstance(result[0], ErrorStreamResponse)
    assert str(result[0].err) == "native_execution_error"
    assert saver.calls == []


def test_queue_unknown_value_refuses_before_base_serializer(guard, monkeypatch):
    bind_queue_cache(monkeypatch)
    q = WorkflowAppQueueManager("task", "actor", InvokeFrom.DEBUGGER, "workflow", native_observation=guard)
    trip_calls = []

    def trip(*args, **kwargs):
        trip_calls.append((args, kwargs))
        raise AssertionError("raw model_dump")

    monkeypatch.setattr(QueueWorkflowSucceededEvent, "model_dump", trip)
    with pytest.raises(NativeObservationError):
        q.publish(QueueWorkflowSucceededEvent(outputs={"x": Unrenderable()}), PublishFrom.APPLICATION_MANAGER)
    assert q._q.empty()
    assert trip_calls == []


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
@pytest.mark.parametrize("supplied_host", [None, object()])
def test_resumption_requires_actual_host_not_a_caller_port(guard, monkeypatch, route, supplied_host):
    from core.app.entities.queue_entities import QueueWorkflowStartedEvent
    from graphon.entities import WorkflowStartReason

    bind_queue_cache(monkeypatch)
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


def test_native_pause_response_reuses_cumulative_settled_duration_after_queue_delay(guard, monkeypatch):
    from core.app.entities.queue_entities import QueueWorkflowPausedEvent
    from core.app.entities.task_entities import WorkflowPauseStreamResponse
    from graphon.entities import WorkflowStartReason
    from graphon.entities.pause_reason import SchedulingPause

    clock = [100.0]
    monkeypatch.setattr("repositories.entities.workflow_execution.perf_counter", lambda: clock[0])
    c = converter(guard)
    timing = c._application_generate_entity.workflow_execution_timing
    timing.elapsed_time = 7.0
    c.workflow_start_to_stream_response(
        task_id="task", workflow_run_id="run", workflow_id="workflow", reason=WorkflowStartReason.INITIAL
    )
    clock[0] += 2.0
    assert timing.finish() == 9.0
    clock[0] += 1000.0
    event = QueueWorkflowPausedEvent(
        reasons=[SchedulingPause(message=SENTINEL)], outputs={SENTINEL: SENTINEL}, paused_nodes=["http"]
    )
    state = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0.0)
    responses = c.workflow_pause_to_stream_response(event=event, task_id="task", graph_runtime_state=state)
    assert len(responses) == 1
    response = responses[0]
    assert isinstance(response, WorkflowPauseStreamResponse)
    assert response.data.elapsed_time == 9.0
    assert response.data.outputs["redacted"] is True
    assert SENTINEL not in response.model_dump_json()
    assert event.outputs == {SENTINEL: SENTINEL}
    assert not guard.failed
