"""Actual persistence/domain/serializer/offload code with in-memory SQL/storage ports.

No SQL engine or session is created. The ports acknowledge only this unit fixture,
not durable writes; actual PostgreSQL/storage/observer qualification remains open.
"""

from __future__ import annotations

import importlib
import importlib.util
import json
import traceback
from copy import deepcopy
from datetime import datetime
from typing import cast, override

import pytest
from sqlalchemy.orm import sessionmaker

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
from core.ops.ops_trace_manager import TraceQueueManager
from core.repositories.factory import OrderConfig
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.system_variables import build_system_variables
from graphon.engine.command import InMemoryChannel
from graphon.engine_events import (
    EngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunFailedEvent,
    NodeRunPauseRequestedEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from graphon.entities import WorkflowNodeExecution, WorkflowStartReason
from graphon.entities.pause_reason import SchedulingPause
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from graphon.enums import WorkflowNodeExecutionStatus as Status
from graphon.node_events import NodeRunResult
from graphon.runtime import ReadOnlyRuntimeStateWrapper, RuntimeState, VariablePool
from models import WorkflowNodeExecutionTriggeredFrom
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import AppMode
from services.dify_builder.native_testing.http_binding import build_native_http_profile
from services.dify_builder.native_testing.observation_privacy import NativeHttpObservationPolicy
from services.file_service import FileService
from services.variable_truncator import VariableTruncator
from services.workflow_persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer
from tests.unit_tests.model_factories import make_account, make_upload_file
from tests.unit_tests.services.dify_builder.native_testing.test_observation_privacy import (
    SENTINEL,
)
from tests.unit_tests.services.dify_builder.native_testing.test_observation_privacy import (
    context as qualified_context,
)
from tests.unit_tests.services.dify_builder.native_testing.test_observation_privacy import (
    result as private_result,
)

NOW = datetime(2026, 10, 16)


def adapters():
    name = "services.dify_builder.native_testing.observation_adapters"
    assert importlib.util.find_spec(name) is not None, "native observation guard is missing"
    return importlib.import_module(name)


def policy():
    return NativeHttpObservationPolicy.qualify(context=qualified_context(), profile=build_native_http_profile())


class MemorySQLPort:
    """Single current-row query port for the actual synchronous repository methods."""

    def __init__(self):
        self.rows = {}
        self.current_id = None
        self.commits = 0
        self.flushes = 0
        self.fail = False

    def __call__(self, **_kwargs):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def begin(self):
        return self

    def get(self, _model, identity, *, with_for_update=None):
        # Accept the real Session's locked reread shape; this unit port makes
        # no SQL isolation or durable-lock claim.
        del with_for_update
        return self.rows.get(identity)

    def add(self, model):
        self.rows[model.id] = model

    def merge(self, model):
        self.rows[model.id] = model
        return model

    def execute(self, _statement):
        # The fixture sets current_id from the concrete domain save call. This
        # does not implement SQL selection/tenant filtering or durability.
        return self

    def scalar(self, statement):
        # Match Session.scalar for the repository's locked current-row reread.
        # This remains a query-shape port, with no claim of real SQL locking.
        return self.execute(statement).scalars().first()

    def scalars(self):
        return self

    def first(self):
        return self.rows.get(self.current_id)

    def commit(self):
        if self.fail:
            raise RuntimeError(SENTINEL)
        self.commits += 1

    def flush(self):
        if self.fail:
            raise RuntimeError(SENTINEL)
        self.flushes += 1


class MemoryFiles:
    def __init__(self):
        self.uploads = []
        self.fail = False

    def upload_file(self, *, content, **_kwargs):
        if self.fail:
            raise RuntimeError(SENTINEL)
        self.uploads.append(content)
        return make_upload_file(file_id=f"file-{len(self.uploads)}", tenant_id="tenant", size=len(content))


class UnitRunRepository(SQLAlchemyWorkflowExecutionRepository):
    """Real save/serializer with explicit in-memory SQL port; constructor IO skipped."""

    def __init__(self):
        self.sql = MemorySQLPort()
        self._session_factory = cast(sessionmaker, self.sql)
        self._tenant_id = "tenant"
        self._app_id = "app"
        self._creator_user_id = "actor"
        self._creator_user_role = CreatorUserRole.ACCOUNT
        self._triggered_from = WorkflowRunTriggeredFrom.DEBUGGING
        self._execution_cache = {}
        self.saved = []

    @override
    def save(self, execution):
        self.saved.append(execution.model_copy(deep=True))
        self.sql.current_id = execution.id_
        super().save(execution)


class UnitNodeRepository(SQLAlchemyWorkflowNodeExecutionRepository):
    """Real save/save_execution_data/truncation/offload with memory ports only."""

    def __init__(self):
        self.sql = MemorySQLPort()
        self._session_factory = cast(sessionmaker, self.sql)
        self._tenant_id = "tenant"
        self._app_id = "app"
        self._creator_user_id = "actor"
        self._creator_user_role = CreatorUserRole.ACCOUNT
        self._triggered_from = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
        self._user = make_account(account_id="actor")
        self._node_execution_cache = {}
        self.files = MemoryFiles()
        self._file_service = cast(FileService, self.files)
        self.saved = []
        self.loaded = []
        self.load_calls = 0

    @override
    def _create_truncator(self):
        # Real native truncation, made small so even the redacted full payload
        # takes the real upload path. No source/config mutation is needed.
        return VariableTruncator(max_size_bytes=48, string_length_limit=8, array_element_limit=2)

    @override
    def save(self, execution):
        self.saved.append(execution.model_copy(deep=True))
        self.sql.current_id = execution.id
        super().save(execution)

    @override
    def save_execution_data(self, execution):
        self.sql.current_id = execution.id
        super().save_execution_data(execution)

    @override
    def get_by_workflow_execution(
        self,
        workflow_execution_id: str,
        order_config: OrderConfig | None = None,
        *,
        include_paused: bool = False,
    ):
        del workflow_execution_id, order_config, include_paused
        self.load_calls += 1
        return self.loaded


def make_layer(*, guard=None, trace=None):
    ctx = qualified_context()
    runtime = RuntimeState(
        workflow_id="workflow",
        variable_pool=VariablePool.from_bootstrap(
            system_variables=build_system_variables(workflow_execution_id="run", conversation_id="conversation")
        ),
        start_at=0.0,
    )
    runtime.variable_pool.add(["sys", "query"], SENTINEL)
    entity = WorkflowAppGenerateEntity.model_construct(
        task_id="task",
        app_config=WorkflowUIBasedAppConfig(
            app_id="app", tenant_id="tenant", workflow_id="workflow", app_mode=AppMode.WORKFLOW
        ),
        inputs={SENTINEL: SENTINEL},
        files=[],
        user_id="actor",
        stream=False,
        invoke_from=None,
        trace_manager=None,
        workflow_execution_id="run",
        extras={},
        call_depth=0,
    )
    info = PersistenceWorkflowInfo(
        workflow_id="workflow", workflow_type=WorkflowType.WORKFLOW, version="1", graph_data=ctx.graph
    )
    runs, nodes = UnitRunRepository(), UnitNodeRepository()
    kwargs = {"native_observation": guard} if guard is not None else {}
    layer = WorkflowPersistenceLayer(
        application_generate_entity=entity,
        workflow_info=info,
        workflow_execution_repository=runs,
        workflow_node_execution_repository=nodes,
        trace_manager=trace,
        **kwargs,
    )
    layer.initialize(ReadOnlyRuntimeStateWrapper(runtime), command_channel=InMemoryChannel())
    # WorkflowRunAgg supplies indices before node lifecycle events in 0.8.
    layer.set_node_run_indices({"execution": 1})
    return layer, runs, nodes, runtime, entity, info


@pytest.fixture(autouse=True)
def quiet_inspector(monkeypatch):
    monkeypatch.setattr("services.workflow_persistence._inspector_publish_node_changed", lambda **_kwargs: None)
    monkeypatch.setattr("services.workflow_persistence._inspector_publish_workflow_completed", lambda **_kwargs: None)


def started():
    return NodeRunStartedEvent(
        id="execution",
        node_id="http",
        node_type="http-request",
        node_title=SENTINEL,
        start_at=NOW,
        predecessor_node_id="start",
    )


def succeeded():
    return NodeRunSucceededEvent(
        id="execution",
        node_id="http",
        node_type="http-request",
        start_at=NOW,
        finished_at=NOW,
        node_run_result=NodeRunResult(
            status=Status.SUCCEEDED,
            inputs={SENTINEL: SENTINEL},
            outputs={"body": SENTINEL * 10_000},
            process_data={"request": SENTINEL},
        ),
    )


def test_guard_requires_actual_policy_and_callback_before_any_projection():
    module = adapters()
    with pytest.raises(TypeError):
        module.NativeObservationGuard(policy=policy())
    with pytest.raises(module.NativeObservationError):
        module.NativeObservationGuard(policy=object(), on_failure=lambda: None)
    with pytest.raises(module.NativeObservationError):
        module.NativeObservationGuard(policy=policy(), on_failure=None)


def test_actual_layer_projects_before_caches_serializer_and_full_offload():
    failures = []
    guard = adapters().NativeObservationGuard(policy=policy(), on_failure=lambda: failures.append("failed"))
    layer, runs, nodes, runtime, entity, info = make_layer(guard=guard)
    raw_graph = deepcopy(info.graph_data)
    raw_inputs = deepcopy(entity.inputs)
    raw_event = succeeded()
    before_event = raw_event.model_dump(mode="json")
    layer.on_graph_start()
    layer.on_event(GraphRunStartedEvent())
    layer.on_event(started())
    layer.on_event(raw_event)
    assert nodes.files.uploads
    for record in runs.saved + nodes.saved:
        assert SENTINEL not in record.model_dump_json()
    for content in nodes.files.uploads:
        decoded = json.loads(content)
        assert SENTINEL not in content.decode()
        assert decoded["redacted"] is True
    assert SENTINEL not in json.dumps(layer._node_execution_cache["execution"].model_dump(mode="json"))
    assert layer._node_execution_cache["execution"].title == "http-request"
    assert nodes.saved[-1].id == "execution"
    assert nodes.saved[-1].workflow_execution_id == "run"
    assert nodes.saved[-1].status is Status.SUCCEEDED
    assert nodes.sql.flushes > 0
    assert runs.sql.commits > 0
    assert raw_event.model_dump(mode="json") == before_event
    assert info.graph_data == raw_graph
    assert entity.inputs == raw_inputs
    assert runtime.variable_pool.get_by_prefix("sys")["query"] == SENTINEL
    assert failures == []
    assert guard.failed is False


@pytest.mark.parametrize(
    "event",
    [
        GraphRunSucceededEvent(outputs={}),
        GraphRunPartialSucceededEvent(outputs={}, exceptions_count=2),
        GraphRunFailedEvent(error=SENTINEL),
        GraphRunAbortedEvent(reason=SENTINEL),
        GraphRunPausedEvent(reasons=[SchedulingPause(message=SENTINEL)], outputs={}),
    ],
)
def test_runtime_fallback_is_projected_without_changing_operational_outputs(event):
    guard = adapters().NativeObservationGuard(policy=policy(), on_failure=lambda: None)
    layer, runs, _, runtime, _, _ = make_layer(guard=guard)
    layer.on_event(GraphRunStartedEvent())
    runtime.set_output("answer", {"body": SENTINEL})
    runtime.increment_node_run_steps()
    layer.on_event(event)
    saved = runs.saved[-1]
    assert SENTINEL not in saved.model_dump_json()
    if isinstance(event, GraphRunPausedEvent):
        # The 0.8 aggregate waits for engine closure before persisting pause.
        # A layer event alone must not publish an early durable transition.
        assert len(runs.saved) == 1
        assert saved.status is WorkflowExecutionStatus.RUNNING
        assert saved.outputs is None
        assert runtime.outputs == {"answer": {"body": SENTINEL}}
        return
    assert saved.outputs["redacted"] is True
    assert saved.outputs["shape"]["fields"] == 1
    assert saved.total_steps == 1
    assert (
        saved.status
        is {
            GraphRunSucceededEvent: WorkflowExecutionStatus.SUCCEEDED,
            GraphRunPartialSucceededEvent: WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
            GraphRunFailedEvent: WorkflowExecutionStatus.FAILED,
            GraphRunAbortedEvent: WorkflowExecutionStatus.STOPPED,
            GraphRunPausedEvent: WorkflowExecutionStatus.PAUSED,
        }[type(event)]
    )
    assert runtime.outputs == {"answer": {"body": SENTINEL}}


def test_retry_history_is_projected_before_real_save_upload_and_keeps_safe_metadata():
    guard = adapters().NativeObservationGuard(policy=policy(), on_failure=lambda: None)
    layer, _, nodes, _, _, _ = make_layer(guard=guard)
    layer.on_event(GraphRunStartedEvent())
    layer.on_event(started())
    node_result = private_result()
    event = NodeRunRetryEvent(
        id="execution",
        node_id="http",
        node_type="http-request",
        node_title=SENTINEL,
        start_at=NOW,
        error=SENTINEL,
        retry_index=2,
        node_run_result=node_result,
    )
    original = event.model_dump(mode="json")
    layer.on_event(event.model_copy(update={"retry_index": 1}))
    layer.on_event(event)
    process_data = layer._node_execution_cache["execution"].process_data
    assert process_data is not None
    assert len(process_data["__dify_retry_history"]) == 2
    latest = process_data["__dify_retry_history"][-1]
    assert latest["execution_metadata"]["iteration_index"] == 2
    assert latest["execution_metadata"]["total_tokens"] == 4
    assert SENTINEL not in json.dumps(process_data)
    assert all(SENTINEL not in blob.decode() for blob in nodes.files.uploads)
    assert event.model_dump(mode="json") == original


def test_guarded_initial_inputs_never_enter_ordinary_special_value_serializer(monkeypatch):
    guard = adapters().NativeObservationGuard(policy=policy(), on_failure=lambda: None)
    layer, runs, _, _, _, _ = make_layer(guard=guard)

    def forbidden(_value):
        raise AssertionError("raw ordinary serializer should not run for marked inputs")

    monkeypatch.setattr("services.workflow_runtime.entry.WorkflowEntry.handle_special_values", forbidden)
    layer.on_event(GraphRunStartedEvent())
    assert runs.saved[0].inputs["redacted"] is True
    assert SENTINEL not in runs.saved[0].model_dump_json()


def test_projection_failure_is_sticky_notifies_host_and_never_saves_raw_fallback():
    notices = []
    module = adapters()
    guard = module.NativeObservationGuard(policy=policy(), on_failure=lambda: notices.append("failure"))
    layer, runs, nodes, _, _, _ = make_layer(guard=guard)
    with pytest.raises(module.NativeObservationError) as caught:
        layer.on_event(EngineEvent())
    assert notices == ["failure"]
    assert guard.failed is True
    assert SENTINEL not in "".join(traceback.format_exception(caught.value))
    with pytest.raises(module.NativeObservationError):
        layer.on_event(GraphRunStartedEvent())
    assert runs.saved == []
    assert nodes.saved == []


@pytest.mark.parametrize("failure", ["run-save", "node-save", "offload"])
def test_repository_failures_latch_guard_and_surface_only_fixed_safe_error(failure):
    notices = []
    module = adapters()
    guard = module.NativeObservationGuard(policy=policy(), on_failure=lambda: notices.append("failure"))
    layer, runs, nodes, _, _, _ = make_layer(guard=guard)
    if failure != "run-save":
        layer.on_event(GraphRunStartedEvent())
    if failure == "offload":
        layer.on_event(started())
        nodes.files.fail = True
        event = succeeded()
    elif failure == "node-save":
        nodes.sql.fail = True
        event = started()
    else:
        runs.sql.fail = True
        event = GraphRunStartedEvent()
    with pytest.raises(module.NativeObservationError) as caught:
        layer.on_event(event)
    assert guard.failed is True
    assert notices == ["failure"]
    assert str(caught.value) == "native_observation_failed"
    assert SENTINEL not in "".join(traceback.format_exception(caught.value))
    with pytest.raises(module.NativeObservationError):
        guard.require_healthy()


def test_failed_callback_is_safe_and_cannot_restore_success():
    module = adapters()

    class CallbackError(Exception):
        @override
        def __str__(self):
            raise AssertionError("raw callback exception rendered")

    calls = []

    def callback():
        calls.append(1)
        raise CallbackError(SENTINEL)

    guard = module.NativeObservationGuard(policy=policy(), on_failure=callback)
    with pytest.raises(module.NativeObservationError) as caught:
        guard.event(EngineEvent())
    assert guard.failed is True
    assert calls == [1]
    assert str(caught.value) == "native_observation_failed"
    assert SENTINEL not in "".join(traceback.format_exception(caught.value))


def test_native_resumption_refuses_before_old_row_load_or_cache_and_run_save():
    notices = []
    module = adapters()
    guard = module.NativeObservationGuard(policy=policy(), on_failure=lambda: notices.append(1))
    layer, runs, nodes, _, _, _ = make_layer(guard=guard)
    nodes.loaded = [
        WorkflowNodeExecution(
            id="old",
            workflow_id="workflow",
            workflow_execution_id="run",
            index=1,
            node_id="http",
            node_type="http-request",
            title=SENTINEL,
            created_at=NOW,
            process_data={"__dify_retry_history": [SENTINEL]},
        )
    ]
    with pytest.raises(module.NativeObservationError):
        layer.on_event(GraphRunStartedEvent(reason=WorkflowStartReason.RESUMPTION))
    assert nodes.load_calls == 0
    assert layer._node_execution_cache == {}
    assert runs.saved == []
    assert notices == [1]


class RejectRawTrace:
    """Trace queue boundary that must never receive marked persistence events."""

    def add_trace_task(self, _task):
        pytest.fail("raw trace enqueue")


def test_trace_owner_is_refused_before_marked_persistence_or_enqueues():
    notices = []
    module = adapters()
    guard = module.NativeObservationGuard(policy=policy(), on_failure=lambda: notices.append(1))
    with pytest.raises(module.NativeObservationError):
        make_layer(guard=guard, trace=RejectRawTrace())
    assert guard.failed is True
    assert notices == [1]


def test_two_actual_observers_have_independent_diagnostic_caches():
    left = make_layer(guard=adapters().NativeObservationGuard(policy=policy(), on_failure=lambda: None))
    right = make_layer(guard=adapters().NativeObservationGuard(policy=policy(), on_failure=lambda: None))
    event = succeeded()
    for layer, *_ in (left, right):
        layer.on_event(GraphRunStartedEvent())
        layer.on_event(started())
        layer.on_event(event)
    cast(dict, left[0]._node_execution_cache["execution"].outputs)["redacted"] = False
    right_outputs = right[0]._node_execution_cache["execution"].outputs
    assert right_outputs is not None
    assert right_outputs["redacted"] is True
    assert event.node_run_result.outputs["body"] == SENTINEL * 10_000


def test_ordinary_real_persistence_preserves_content_and_exceptions_without_guard():
    layer, runs, nodes, runtime, entity, info = make_layer()
    layer.on_event(GraphRunStartedEvent())
    layer.on_event(started())
    layer.on_event(succeeded())
    runtime.set_output("answer", SENTINEL)
    layer.on_event(GraphRunSucceededEvent(outputs={}))
    assert runs.saved[0].graph == info.graph_data
    assert runs.saved[0].inputs[SENTINEL] == entity.inputs[SENTINEL]
    assert runs.saved[0].inputs["sys.query"] == SENTINEL
    assert runs.saved[-1].outputs == {"answer": SENTINEL}
    assert nodes.saved[-1].title == SENTINEL
    assert any(SENTINEL in blob.decode() for blob in nodes.files.uploads)
    runs.sql.fail = True
    with pytest.raises(RuntimeError, match=SENTINEL):
        layer.on_event(GraphRunSucceededEvent(outputs={}))


def test_ordinary_resumption_still_uses_existing_loaded_domain_rows():
    layer, _, nodes, _, _, _ = make_layer()
    old = WorkflowNodeExecution(
        id="old",
        workflow_id="workflow",
        workflow_execution_id="run",
        index=4,
        node_id="http",
        node_type="http-request",
        title=SENTINEL,
        created_at=NOW,
    )
    nodes.loaded = [old]
    from services.workflow_run_index import WorkflowRunIndex

    # The 0.8 aggregate loads history and installs both consumers before run.
    histories = nodes.get_by_workflow_execution("run", include_paused=True)
    index = WorkflowRunIndex(histories)
    layer.set_node_execution_history(histories)
    layer.set_node_run_indices(index.indices)
    layer.on_event(GraphRunStartedEvent(reason=WorkflowStartReason.RESUMPTION))
    assert nodes.load_calls == 1
    assert layer._node_execution_cache["old"] is old
    assert index.index_for("old") == 4
    assert index.root_snapshots[0].title == SENTINEL


def test_async_generator_callback_object_is_not_a_synchronous_host_latch():
    class AsyncCallback:
        async def __call__(self):
            yield None

    with pytest.raises(adapters().NativeObservationError):
        adapters().NativeObservationGuard(policy=policy(), on_failure=AsyncCallback())


def test_policy_subclasses_cannot_replace_the_exact_server_policy():
    class DerivedPolicy(NativeHttpObservationPolicy):
        pass

    derived = DerivedPolicy.qualify(context=qualified_context(), profile=build_native_http_profile())
    with pytest.raises(adapters().NativeObservationError):
        adapters().NativeObservationGuard(policy=derived, on_failure=lambda: None)


def test_reentrant_failure_callback_observes_sticky_fact_without_deadlock():
    notices = []
    module = adapters()

    def callback():
        notices.append(guard.failed)
        guard.require_healthy()

    guard = module.NativeObservationGuard(policy=policy(), on_failure=callback)
    with pytest.raises(module.NativeObservationError):
        guard.event(EngineEvent())
    assert notices == [True]
    assert guard.failed is True


def test_concurrent_failures_notify_actual_callback_before_any_refusal_completes():
    from threading import Event, Thread

    entered, release, second_started, second_done = Event(), Event(), Event(), Event()
    module = adapters()
    notices, errors = [], []

    def callback():
        notices.append(guard.failed)
        entered.set()
        assert release.wait(2)

    guard = module.NativeObservationGuard(policy=policy(), on_failure=callback)

    def invoke(second=False):
        if second:
            second_started.set()
        try:
            guard.event(EngineEvent())
        except module.NativeObservationError as error:
            errors.append(str(error))
        finally:
            if second:
                second_done.set()

    first, second = Thread(target=invoke), Thread(target=lambda: invoke(True))
    first.start()
    try:
        assert entered.wait(1)
        second.start()
        assert second_started.wait(1)
        assert not second_done.wait(0.1)
    finally:
        release.set()
        first.join(2)
        if second.ident is not None:
            second.join(2)
    assert not first.is_alive()
    assert not second.is_alive()
    assert notices == [True]
    assert errors == ["native_observation_failed", "native_observation_failed"]


def test_business_node_failure_is_preserved_without_marking_observation_failed():
    guard = adapters().NativeObservationGuard(policy=policy(), on_failure=lambda: pytest.fail("not observer failure"))
    layer, _, nodes, _, _, _ = make_layer(guard=guard)
    layer.on_event(GraphRunStartedEvent())
    layer.on_event(started())
    event = NodeRunFailedEvent(
        id="execution",
        node_id="http",
        node_type="http-request",
        start_at=NOW,
        finished_at=NOW,
        error=SENTINEL,
        node_run_result=private_result(),
    )
    layer.on_event(event)
    layer.on_graph_end(RuntimeError(SENTINEL))
    assert nodes.saved[-1].status is Status.FAILED
    assert nodes.saved[-1].error == "native_execution_error"
    assert guard.failed is False


def test_marked_native_node_pause_retains_pause_semantics_with_no_raw_process_data():
    guard = adapters().NativeObservationGuard(policy=policy(), on_failure=lambda: None)
    layer, _, nodes, _, _, _ = make_layer(guard=guard)
    layer.on_event(GraphRunStartedEvent())
    layer.on_event(started())
    event = NodeRunPauseRequestedEvent(
        id="execution",
        node_id="http",
        node_type="http-request",
        reason=SchedulingPause(message=SENTINEL),
        node_run_result=NodeRunResult(status=Status.PAUSED, process_data={"request": SENTINEL}),
    )
    layer.on_event(event)
    assert nodes.saved[-1].status is Status.PAUSED
    assert nodes.saved[-1].outputs is None
    assert SENTINEL not in nodes.saved[-1].model_dump_json()


def test_nonempty_graph_event_keeps_ordinary_output_selection_over_live_runtime():
    guard = adapters().NativeObservationGuard(policy=policy(), on_failure=lambda: None)
    layer, runs, _, runtime, _, _ = make_layer(guard=guard)
    layer.on_event(GraphRunStartedEvent())
    runtime.set_output("a", SENTINEL)
    runtime.set_output("b", SENTINEL)
    layer.on_event(GraphRunSucceededEvent(outputs={"selected": SENTINEL}))
    assert runs.saved[-1].outputs["shape"]["fields"] == 1
    assert runtime.outputs == {"a": SENTINEL, "b": SENTINEL}


def test_failed_guard_cannot_be_cleared_by_graph_lifecycle_hooks():
    guard = adapters().NativeObservationGuard(policy=policy(), on_failure=lambda: None)
    layer, _, _, _, _, _ = make_layer(guard=guard)
    with pytest.raises(adapters().NativeObservationError):
        guard.fail()
    for hook in (layer.on_graph_start, lambda: layer.on_graph_end(None)):
        with pytest.raises(adapters().NativeObservationError):
            hook()
    assert guard.failed is True


def test_late_trace_owner_cannot_enqueue_after_marked_construction():
    guard = adapters().NativeObservationGuard(policy=policy(), on_failure=lambda: None)
    layer, _, _, _, entity, _ = make_layer(guard=guard)
    layer.on_event(GraphRunStartedEvent())
    entity.trace_manager = cast(TraceQueueManager, RejectRawTrace())
    with pytest.raises(adapters().NativeObservationError):
        layer.on_event(GraphRunSucceededEvent())
    assert guard.failed is True


def test_run_id_and_initial_system_values_never_render_unknown_objects():
    calls = []

    class Unclassified:
        def __str__(self):
            calls.append(1)
            return SENTINEL

        def __repr__(self):
            calls.append(1)
            return SENTINEL

    guard = adapters().NativeObservationGuard(policy=policy(), on_failure=lambda: None)
    with pytest.raises(adapters().NativeObservationError):
        guard.workflow_execution_id({"workflow_execution_id": Unclassified()})
    assert calls == []
    assert guard.failed is True
