from collections.abc import Callable
from threading import Event
from unittest.mock import Mock, create_autospec

import pytest

from repositories.workflow.debug_reservation_repository import WorkflowDebugReservationRepository
from services.errors.workflow_service import WorkflowDebugReservationExpiredError
from services.workflow.debug_worker_lease import keep_debug_worker_alive
from services.workflow.execution.ports import WorkflowRuntime


def test_silent_worker_renews_until_execution_scope_exits(config_overrides: Callable[..., None]) -> None:
    config_overrides(WORKFLOW_DEBUG_RESERVATION_TIMEOUT=1)
    renewed = Event()
    reservations = create_autospec(WorkflowDebugReservationRepository, instance=True, spec_set=True)

    def renew(**_kwargs: object) -> bool:
        if reservations.renew.call_count > 1:
            renewed.set()
        return True

    reservations.renew.side_effect = renew
    with keep_debug_worker_alive(
        reservations, tenant_id="tenant", app_id="app", workflow_id="workflow", execution_id="run"
    ):
        # No stream events are needed to renew a long-running model/tool call.
        assert renewed.wait(timeout=2)
    calls = reservations.renew.call_count
    renewed.clear()
    assert not renewed.wait(timeout=0.4)
    assert reservations.renew.call_count == calls


def test_reclaimed_debug_lease_cannot_enter_engine() -> None:
    reservations = create_autospec(WorkflowDebugReservationRepository, instance=True, spec_set=True)
    reservations.renew.return_value = False
    with pytest.raises(WorkflowDebugReservationExpiredError):
        with keep_debug_worker_alive(
            reservations, tenant_id="tenant", app_id="app", workflow_id="workflow", execution_id="run"
        ):
            pytest.fail("a reclaimed worker entered the engine")


@pytest.mark.parametrize("failure", ["rejected", "database_unavailable"])
def test_lease_lost_during_execution_is_reported_to_owner(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], failure: str
) -> None:
    config_overrides(WORKFLOW_DEBUG_RESERVATION_TIMEOUT=1)
    clock = [0.0]
    monkeypatch.setattr("services.workflow.debug_worker_lease.monotonic", lambda: clock[0])
    monkeypatch.setattr("services.workflow.debug_cancellation.monotonic", lambda: clock[0])
    checked = Event()
    reservations = create_autospec(WorkflowDebugReservationRepository, instance=True, spec_set=True)

    def renew(**_kwargs: object) -> bool:
        if reservations.renew.call_count == 1:
            return True
        checked.set()
        if failure == "database_unavailable":
            clock[0] = 2.0
            raise RuntimeError("database unavailable past the lease deadline")
        return False

    reservations.renew.side_effect = renew
    with pytest.raises(WorkflowDebugReservationExpiredError):
        with keep_debug_worker_alive(
            reservations, tenant_id="tenant", app_id="app", workflow_id="workflow", execution_id="run"
        ):
            assert checked.wait(timeout=2)


def test_lost_lease_aborts_real_graph_and_prevents_successor_node(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    from graphon.graph_engine import GraphEngine, GraphEngineConfig
    from graphon.graph_engine.command_channels import InMemoryChannel
    from graphon.graph_events import GraphEngineEvent, GraphRunAbortedEvent
    from services.workflow.execution.adapters.workflow.stop_aware_ready_queue import attach_stop_aware_ready_queue
    from tests.unit_tests.core.workflow.graph_engine.test_table_runner import WorkflowRunner

    config_overrides(WORKFLOW_DEBUG_RESERVATION_TIMEOUT=3)
    runner = WorkflowRunner()
    graph, state = runner.create_graph_from_fixture(
        fixture_data=runner.load_fixture("basic_chatflow"), query="hello", use_mock_factory=True
    )
    aborted = Event()
    started_node = Event()
    original_abort = state.graph_execution.abort

    def abort(reason: str) -> None:
        original_abort(reason)
        aborted.set()

    monkeypatch.setattr(state.graph_execution, "abort", abort)
    original_run = graph.nodes["llm"]._run

    def delayed_node() -> object:
        started_node.set()
        assert aborted.wait(timeout=4)
        return original_run()

    monkeypatch.setattr(graph.nodes["llm"], "_run", delayed_node)
    successor = Mock(side_effect=AssertionError("successor executed after lease loss"))
    monkeypatch.setattr(graph.nodes["answer"], "_run", successor)
    reservations = create_autospec(WorkflowDebugReservationRepository, instance=True, spec_set=True)

    def renew(**_kwargs: object) -> bool:
        return not started_node.is_set()

    reservations.renew.side_effect = renew
    events: list[GraphEngineEvent] = []

    def execute() -> None:
        nonlocal events
        with keep_debug_worker_alive(
            reservations, tenant_id="tenant", app_id="app", workflow_id="workflow", execution_id="run"
        ) as cancellation:
            cancellation.bind(state.graph_execution)
            attach_stop_aware_ready_queue(state, task_id="task", should_stop=cancellation.is_cancelled)
            engine = GraphEngine(
                workflow_id="workflow",
                graph=graph,
                graph_runtime_state=state,
                command_channel=InMemoryChannel(),
                config=GraphEngineConfig(),
            )
            events = list(engine.run())

    with pytest.raises(WorkflowDebugReservationExpiredError):
        execute()
    assert any(isinstance(event, GraphRunAbortedEvent) for event in events)
    successor.assert_not_called()
    assert state.graph_execution.aborted is True


@pytest.mark.parametrize("outcome", ["paused", "completed"])
def test_finished_graph_is_not_cancelled_when_terminal_write_ends_lease(outcome: str) -> None:
    from time import monotonic

    from graphon.graph_engine.domain.graph_execution import GraphExecution
    from services.workflow.debug_cancellation import DebugExecutionCancellation

    state = GraphExecution(workflow_id="workflow", started=True)
    cancellation = DebugExecutionCancellation(deadline=monotonic() + 10)
    cancellation.bind(state)
    setattr(state, outcome, True)
    cancellation.cancel()
    cancellation.raise_if_cancelled()
    assert state.aborted is False


def test_blocked_renewal_or_suspended_process_cannot_start_queued_node(monkeypatch: pytest.MonkeyPatch) -> None:
    from queue import Empty

    from graphon.graph_engine.domain.graph_execution import GraphExecution
    from services.workflow import debug_cancellation as module
    from services.workflow.execution.adapters.workflow.stop_aware_ready_queue import StopAwareReadyQueue

    monkeypatch.setattr(module, "monotonic", lambda: 0)
    state = GraphExecution(workflow_id="workflow", started=True)
    cancellation = module.DebugExecutionCancellation(deadline=10)
    cancellation.bind(state)
    inner = Mock()
    queue = StopAwareReadyQueue(inner, task_id="task", graph_execution=state, should_stop=cancellation.is_cancelled)
    # The process resumes scheduling before its heartbeat thread returns.
    monkeypatch.setattr(module, "monotonic", lambda: 11)
    with pytest.raises(Empty):
        queue.get()
    assert state.aborted is True
    inner.task_done.assert_called_once()
    cancellation.renew_until(20)
    with pytest.raises(WorkflowDebugReservationExpiredError):
        cancellation.raise_if_cancelled()


def test_blocked_database_renewal_still_aborts_active_execution(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    from graphon.graph_engine.domain.graph_execution import GraphExecution

    config_overrides(WORKFLOW_DEBUG_RESERVATION_TIMEOUT=1)
    clock = [0.0]
    monkeypatch.setattr("services.workflow.debug_worker_lease.monotonic", lambda: clock[0])
    monkeypatch.setattr("services.workflow.debug_cancellation.monotonic", lambda: clock[0])
    renewal_blocked = Event()
    release_renewal = Event()
    aborted = Event()
    state = GraphExecution(workflow_id="workflow", started=True)
    original_abort = state.abort

    def abort(reason: str) -> None:
        original_abort(reason)
        aborted.set()

    monkeypatch.setattr(state, "abort", abort)
    reservations = create_autospec(WorkflowDebugReservationRepository, instance=True, spec_set=True)

    def renew(**_kwargs: object) -> bool:
        if reservations.renew.call_count > 1:
            renewal_blocked.set()
            assert release_renewal.wait(timeout=3)
        return True

    reservations.renew.side_effect = renew

    def execute() -> None:
        with keep_debug_worker_alive(
            reservations, tenant_id="tenant", app_id="app", workflow_id="workflow", execution_id="run"
        ) as cancellation:
            cancellation.bind(state)
            assert renewal_blocked.wait(timeout=2)
            clock[0] = 2.0
            try:
                # The executing node has not returned to the ready queue and
                # the database call has not returned to the renewal thread.
                assert aborted.wait(timeout=2)
            finally:
                release_renewal.set()

    with pytest.raises(WorkflowDebugReservationExpiredError):
        execute()
    assert state.aborted is True


def test_resumed_runner_does_not_treat_previous_pause_as_current_completion(
    monkeypatch: pytest.MonkeyPatch, *, workflow_runtime: WorkflowRuntime
) -> None:
    from time import monotonic

    from core.app.apps.base_app_queue_manager import AppQueueManager
    from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
    from core.repositories.factory import WorkflowExecutionRepository, WorkflowNodeExecutionRepository
    from graphon.runtime import GraphRuntimeState, VariablePool
    from graphon.variable_loader import DUMMY_VARIABLE_LOADER
    from models.model import AppMode
    from services.workflow.debug_cancellation import DebugExecutionCancellation
    from services.workflow.execution.adapters.workflow.app_config_manager import WorkflowAppConfig
    from services.workflow.execution.adapters.workflow.app_runner import WorkflowAppRunner
    from tests.unit_tests.model_factories import make_workflow

    state = GraphRuntimeState(variable_pool=VariablePool(), start_at=0)
    state.graph_execution.started = True
    state.graph_execution.paused = True
    cancellation = DebugExecutionCancellation(deadline=monotonic() + 10)
    entity = WorkflowAppGenerateEntity.model_construct(
        app_config=WorkflowAppConfig.model_construct(app_id="app", app_mode=AppMode.WORKFLOW),
        invoke_from=InvokeFrom.DEBUGGER,
        user_id="account",
        task_id="task",
        extras={},
    )
    runner = WorkflowAppRunner(
        application_generate_entity=entity,
        queue_manager=create_autospec(AppQueueManager, instance=True, spec_set=True),
        variable_loader=DUMMY_VARIABLE_LOADER,
        workflow=make_workflow(),
        system_user_id="account",
        workflow_execution_repository=create_autospec(
            WorkflowExecutionRepository, instance=True, spec_set=True
        ),
        workflow_node_execution_repository=create_autospec(
            WorkflowNodeExecutionRepository, instance=True, spec_set=True
        ),
        graph_runtime_state=state,
        cancellation=cancellation,
        runtime=workflow_runtime,
    )
    monkeypatch.setattr(runner._graphs, "build", Mock())

    def lose_lease_before_engine_starts(**_kwargs: object) -> None:
        cancellation.cancel()
        cancellation.raise_if_cancelled()
        pytest.fail("previous pause masked lease loss during resume")

    monkeypatch.setattr(
        "services.workflow.execution.adapters.workflow.app_runner.WorkflowEntry", lose_lease_before_engine_starts
    )
    with pytest.raises(WorkflowDebugReservationExpiredError):
        runner.run()
    assert state.graph_execution.aborted is True
