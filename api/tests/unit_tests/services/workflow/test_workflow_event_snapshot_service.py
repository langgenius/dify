import json
import queue
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from itertools import cycle
from threading import Event

import pytest
from graphon.entities.pause_reason import HumanInputRequired
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from graphon.runtime import VariablePool

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
from core.workflow.runtime_state import create_graph_runtime_state, snapshot_graph_runtime_state
from models.enums import CreatorUserRole
from models.model import AppMode
from models.workflow import WorkflowRun
from repositories.api_workflow_node_execution_repository import WorkflowNodeExecutionSnapshot
from repositories.entities.workflow_pause import WorkflowPauseEntity
from services.workflow_event_snapshot_service import (
    BufferState,
    MessageContext,
    _build_snapshot_events,
    _resolve_task_id,
)


@dataclass(frozen=True)
class _FakePauseEntity(WorkflowPauseEntity):
    pause_id: str
    workflow_run_id: str
    paused_at_value: datetime
    pause_reasons: Sequence[HumanInputRequired]

    @property
    def id(self) -> str:
        return self.pause_id

    @property
    def workflow_execution_id(self) -> str:
        return self.workflow_run_id

    def get_state(self) -> bytes:
        raise AssertionError("state is not required for snapshot tests")

    @property
    def resumed_at(self) -> datetime | None:
        return None

    @property
    def paused_at(self) -> datetime:
        return self.paused_at_value

    def get_pause_reasons(self) -> Sequence[HumanInputRequired]:
        return self.pause_reasons


def _build_workflow_run(status: WorkflowExecutionStatus) -> WorkflowRun:
    return WorkflowRun(
        id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type="workflow",
        triggered_from="app-run",
        version="v1",
        graph=None,
        inputs=json.dumps({"input": "value"}),
        status=status,
        outputs=json.dumps({}),
        error=None,
        elapsed_time=0.0,
        total_tokens=0,
        total_steps=0,
        created_by_role=CreatorUserRole.END_USER,
        created_by="user-1",
        created_at=datetime(2024, 1, 1, tzinfo=UTC),
    )


def _build_snapshot(status: WorkflowNodeExecutionStatus) -> WorkflowNodeExecutionSnapshot:
    created_at = datetime(2024, 1, 1, tzinfo=UTC)
    finished_at = datetime(2024, 1, 1, 0, 0, 5, tzinfo=UTC)
    return WorkflowNodeExecutionSnapshot(
        execution_id="exec-1",
        node_id="node-1",
        node_type="human-input",
        title="Human Input",
        index=1,
        status=status.value,
        elapsed_time=0.5,
        created_at=created_at,
        finished_at=finished_at,
        iteration_id=None,
        loop_id=None,
    )


def _build_resumption_context(task_id: str) -> WorkflowResumptionContext:
    app_config = WorkflowUIBasedAppConfig(
        tenant_id="tenant-1",
        app_id="app-1",
        app_mode=AppMode.WORKFLOW,
        workflow_id="workflow-1",
    )
    generate_entity = WorkflowAppGenerateEntity(
        task_id=task_id,
        app_config=app_config,
        inputs={},
        files=[],
        user_id="user-1",
        stream=True,
        invoke_from=InvokeFrom.EXPLORE,
        call_depth=0,
        workflow_execution_id="run-1",
    )
    runtime_state = create_graph_runtime_state(
        variable_pool=VariablePool(),
        start_at=0.0,
        workflow_id="workflow-1",
    )
    runtime_state.register_paused_node("node-1")
    runtime_state.outputs = {"result": "value"}
    wrapper = _WorkflowGenerateEntityWrapper(entity=generate_entity)
    return WorkflowResumptionContext(
        generate_entity=wrapper,
        serialized_graph_runtime_state=snapshot_graph_runtime_state(
            runtime_state,
            workflow_id="workflow-1",
        ),
    )


def test_build_snapshot_events_includes_pause_event() -> None:
    workflow_run = _build_workflow_run(WorkflowExecutionStatus.PAUSED)
    snapshot = _build_snapshot(WorkflowNodeExecutionStatus.PAUSED)
    resumption_context = _build_resumption_context("task-ctx")
    pause_entity = _FakePauseEntity(
        pause_id="pause-1",
        workflow_run_id="run-1",
        paused_at_value=datetime(2024, 1, 1, tzinfo=UTC),
        pause_reasons=[
            HumanInputRequired(
                form_id="form-1",
                form_content="content",
                node_id="node-1",
                node_title="Human Input",
            )
        ],
    )

    events = _build_snapshot_events(
        workflow_run=workflow_run,
        node_snapshots=[snapshot],
        task_id="task-ctx",
        message_context=None,
        pause_entity=pause_entity,
        resumption_context=resumption_context,
    )

    assert [event["event"] for event in events] == [
        "workflow_started",
        "node_started",
        "node_finished",
        "workflow_paused",
    ]
    assert events[2]["data"]["status"] == WorkflowNodeExecutionStatus.PAUSED.value
    pause_data = events[-1]["data"]
    assert pause_data["paused_nodes"] == ["node-1"]
    assert pause_data["outputs"] == {"result": "value"}
    assert pause_data["status"] == WorkflowExecutionStatus.PAUSED.value
    assert pause_data["created_at"] == int(workflow_run.created_at.timestamp())
    assert pause_data["elapsed_time"] == workflow_run.elapsed_time
    assert pause_data["total_tokens"] == workflow_run.total_tokens
    assert pause_data["total_steps"] == workflow_run.total_steps


def test_build_snapshot_events_applies_message_context() -> None:
    workflow_run = _build_workflow_run(WorkflowExecutionStatus.RUNNING)
    snapshot = _build_snapshot(WorkflowNodeExecutionStatus.SUCCEEDED)
    message_context = MessageContext(
        conversation_id="conv-1",
        message_id="msg-1",
        created_at=1700000000,
        answer="snapshot message",
    )

    events = _build_snapshot_events(
        workflow_run=workflow_run,
        node_snapshots=[snapshot],
        task_id="task-1",
        message_context=message_context,
        pause_entity=None,
        resumption_context=None,
    )

    assert [event["event"] for event in events] == [
        "workflow_started",
        "message_replace",
        "node_started",
        "node_finished",
    ]
    assert events[1]["answer"] == "snapshot message"
    for event in events:
        assert event["conversation_id"] == "conv-1"
        assert event["message_id"] == "msg-1"
        assert event["created_at"] == 1700000000


@pytest.mark.parametrize(
    ("context_task_id", "buffered_task_id", "expected"),
    [
        ("task-ctx", "task-buffer", "task-ctx"),
        (None, "task-buffer", "task-buffer"),
        (None, None, "run-1"),
    ],
)
def test_resolve_task_id_priority(context_task_id, buffered_task_id, expected) -> None:
    resumption_context = _build_resumption_context(context_task_id) if context_task_id else None
    buffer_state = BufferState(
        queue=queue.Queue(),
        stop_event=Event(),
        done_event=Event(),
        task_id_ready=Event(),
        task_id_hint=buffered_task_id,
    )
    if buffered_task_id:
        buffer_state.task_id_ready.set()
    task_id = _resolve_task_id(resumption_context, buffer_state, "run-1", wait_timeout=0.0)
    assert task_id == expected


# === Merged from test_workflow_event_snapshot_service_additional.py ===


import json
import queue
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Event
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from graphon.enums import WorkflowExecutionStatus
from graphon.runtime import GraphRuntimeState, VariablePool
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.task_entities import StreamEvent
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
from models.enums import CreatorUserRole
from models.model import AppMode
from models.workflow import WorkflowRun
from repositories.entities.workflow_pause import WorkflowPauseEntity
from services import workflow_event_snapshot_service as service_module
from services.workflow_event_snapshot_service import BufferState, MessageContext, build_workflow_event_stream


def _build_workflow_run_additional(status: WorkflowExecutionStatus = WorkflowExecutionStatus.RUNNING) -> WorkflowRun:
    return WorkflowRun(
        id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type="workflow",
        triggered_from="app-run",
        version="v1",
        graph=None,
        inputs=json.dumps({"query": "hello"}),
        status=status,
        outputs=json.dumps({}),
        error=None,
        elapsed_time=1.2,
        total_tokens=5,
        total_steps=2,
        created_by_role=CreatorUserRole.END_USER,
        created_by="user-1",
        created_at=datetime(2024, 1, 1, tzinfo=UTC),
    )


def _build_resumption_context_additional(task_id: str) -> WorkflowResumptionContext:
    app_config = WorkflowUIBasedAppConfig(
        tenant_id="tenant-1",
        app_id="app-1",
        app_mode=AppMode.WORKFLOW,
        workflow_id="workflow-1",
    )
    generate_entity = WorkflowAppGenerateEntity(
        task_id=task_id,
        app_config=app_config,
        inputs={},
        files=[],
        user_id="user-1",
        stream=True,
        invoke_from=InvokeFrom.EXPLORE,
        call_depth=0,
        workflow_execution_id="run-1",
    )
    runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=0.0)
    runtime_state.outputs = {"answer": "ok"}
    wrapper = _WorkflowGenerateEntityWrapper(entity=generate_entity)
    return WorkflowResumptionContext(
        generate_entity=wrapper,
        serialized_graph_runtime_state=runtime_state.dumps(),
    )


class _SessionContext:
    def __init__(self, session: Any) -> None:
        self._session = session

    def __enter__(self) -> Any:
        return self._session

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        return False


class _SessionMaker:
    def __init__(self, session: Any) -> None:
        self._session = session

    def __call__(self) -> _SessionContext:
        return _SessionContext(self._session)


class _SubscriptionContext:
    def __init__(self, subscription: Any) -> None:
        self._subscription = subscription

    def __enter__(self) -> Any:
        return self._subscription

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        return False


class _Topic:
    def __init__(self, subscription: Any) -> None:
        self._subscription = subscription

    def subscribe(self) -> _SubscriptionContext:
        return _SubscriptionContext(self._subscription)


class _StaticSubscription:
    def receive(self, timeout: int = 1) -> None:
        return None


@dataclass(frozen=True)
class _PauseEntity(WorkflowPauseEntity):
    state: bytes

    @property
    def id(self) -> str:
        return "pause-1"

    @property
    def workflow_execution_id(self) -> str:
        return "run-1"

    @property
    def resumed_at(self) -> datetime | None:
        return None

    @property
    def paused_at(self) -> datetime:
        return datetime(2024, 1, 1, tzinfo=UTC)

    def get_state(self) -> bytes:
        return self.state

    def get_pause_reasons(self) -> list[Any]:
        return []


def test_get_message_context_should_return_none_when_no_message() -> None:
    # Arrange
    session = SimpleNamespace(scalar=MagicMock(return_value=None))
    session_maker = _SessionMaker(session)

    # Act
    result = service_module._get_message_context(cast(sessionmaker[Session], session_maker), "run-1")

    # Assert
    assert result is None


def test_get_message_context_should_default_created_at_to_zero_when_message_has_no_timestamp() -> None:
    # Arrange
    message = SimpleNamespace(
        id="msg-1",
        conversation_id="conv-1",
        created_at=None,
        answer="answer",
    )
    session = SimpleNamespace(scalar=MagicMock(return_value=message))
    session_maker = _SessionMaker(session)

    # Act
    result = service_module._get_message_context(cast(sessionmaker[Session], session_maker), "run-1")

    # Assert
    assert result is not None
    assert result.created_at == 0
    assert result.message_id == "msg-1"
    assert result.conversation_id == "conv-1"
    assert result.answer == "answer"


def test_load_resumption_context_should_return_none_when_pause_entity_missing() -> None:
    # Arrange

    # Act
    result = service_module._load_resumption_context(None)

    # Assert
    assert result is None


def test_load_resumption_context_should_return_none_when_pause_entity_state_is_invalid() -> None:
    # Arrange
    pause_entity = _PauseEntity(state=b"not-a-valid-state")

    # Act
    result = service_module._load_resumption_context(pause_entity)

    # Assert
    assert result is None


def test_load_resumption_context_should_parse_valid_state_into_context() -> None:
    # Arrange
    context = _build_resumption_context_additional(task_id="task-ctx")
    pause_entity = _PauseEntity(state=context.dumps().encode())

    # Act
    result = service_module._load_resumption_context(pause_entity)

    # Assert
    assert result is not None
    assert result.get_generate_entity().task_id == "task-ctx"


def test_resolve_task_id_should_return_workflow_run_id_when_buffer_state_is_missing() -> None:
    # Arrange

    # Act
    result = service_module._resolve_task_id(
        resumption_context=None,
        buffer_state=None,
        workflow_run_id="run-1",
    )

    # Assert
    assert result == "run-1"


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        (b'{"event":"node_started"}', {"event": "node_started"}),
        (b"invalid-json", None),
        (b"[]", None),
    ],
)
def test_parse_event_message_should_parse_only_json_object(
    payload: bytes,
    expected: dict[str, Any] | None,
) -> None:
    # Arrange

    # Act
    result = service_module._parse_event_message(payload)

    # Assert
    assert result == expected


def test_is_terminal_event_should_recognize_finished_and_optional_paused_events() -> None:
    # Arrange
    finished_event = {"event": StreamEvent.WORKFLOW_FINISHED.value}
    paused_event = {"event": StreamEvent.WORKFLOW_PAUSED.value}

    # Act
    is_finished = service_module._is_terminal_event(finished_event, include_paused=False)
    paused_without_flag = service_module._is_terminal_event(paused_event, include_paused=False)
    paused_with_flag = service_module._is_terminal_event(paused_event, include_paused=True)

    # Assert
    assert is_finished is True
    assert paused_without_flag is False
    assert paused_with_flag is True
    assert service_module._is_terminal_event(StreamEvent.PING.value, include_paused=True) is False


def test_apply_message_context_should_update_payload_when_context_exists() -> None:
    # Arrange
    payload: dict[str, Any] = {"event": "workflow_started"}
    context = MessageContext(conversation_id="conv-1", message_id="msg-1", created_at=1700000000)

    # Act
    service_module._apply_message_context(payload, context)

    # Assert
    assert payload["conversation_id"] == "conv-1"
    assert payload["message_id"] == "msg-1"
    assert payload["created_at"] == 1700000000


def test_start_buffering_should_capture_task_id_and_enqueue_event() -> None:
    # Arrange
    class Subscription:
        def __init__(self) -> None:
            self._calls = 0

        def receive(self, timeout: int = 1) -> bytes | None:
            self._calls += 1
            if self._calls == 1:
                return b'{"event":"node_started","task_id":"task-1"}'
            return None

    subscription = Subscription()

    # Act
    buffer_state = service_module._start_buffering(subscription)
    ready = buffer_state.task_id_ready.wait(timeout=1)
    event = buffer_state.queue.get(timeout=1)
    buffer_state.stop_event.set()
    finished = buffer_state.done_event.wait(timeout=1)

    # Assert
    assert ready is True
    assert finished is True
    assert buffer_state.task_id_hint == "task-1"
    assert event["event"] == "node_started"


def test_start_buffering_should_drop_old_event_when_queue_is_full(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    class QueueWithSingleFull:
        def __init__(self) -> None:
            self._first_put = True
            self.items: list[dict[str, Any]] = [{"event": "old"}]

        def put_nowait(self, item: dict[str, Any]) -> None:
            if self._first_put:
                self._first_put = False
                raise queue.Full
            self.items.append(item)

        def get_nowait(self) -> dict[str, Any]:
            if not self.items:
                raise queue.Empty
            return self.items.pop(0)

        def empty(self) -> bool:
            return len(self.items) == 0

    fake_queue = QueueWithSingleFull()
    monkeypatch.setattr(service_module.queue, "Queue", lambda maxsize=2048: fake_queue)

    class Subscription:
        def __init__(self) -> None:
            self._calls = 0

        def receive(self, timeout: int = 1) -> bytes | None:
            self._calls += 1
            if self._calls == 1:
                return b'{"event":"node_started","task_id":"task-2"}'
            return None

    subscription = Subscription()

    # Act
    buffer_state = service_module._start_buffering(subscription)
    ready = buffer_state.task_id_ready.wait(timeout=1)
    buffer_state.stop_event.set()
    finished = buffer_state.done_event.wait(timeout=1)

    # Assert
    assert ready is True
    assert finished is True
    assert fake_queue.items[-1]["task_id"] == "task-2"


def test_start_buffering_should_set_done_event_when_subscription_raises() -> None:
    # Arrange
    class Subscription:
        def receive(self, timeout: int = 1) -> bytes | None:
            raise RuntimeError("subscription failure")

    subscription = Subscription()

    # Act
    buffer_state = service_module._start_buffering(subscription)
    finished = buffer_state.done_event.wait(timeout=1)

    # Assert
    assert finished is True


def test_build_workflow_event_stream_should_emit_ping_and_terminal_snapshot_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    workflow_run = _build_workflow_run_additional(status=WorkflowExecutionStatus.RUNNING)
    topic = _Topic(_StaticSubscription())
    workflow_run_repo = SimpleNamespace(get_workflow_pause=MagicMock())
    node_repo = SimpleNamespace(get_execution_snapshots_by_workflow_run=MagicMock(return_value=[]))
    factory = SimpleNamespace(
        create_api_workflow_run_repository=MagicMock(return_value=workflow_run_repo),
        create_api_workflow_node_execution_repository=MagicMock(return_value=node_repo),
    )
    monkeypatch.setattr(service_module, "DifyAPIRepositoryFactory", factory)
    monkeypatch.setattr(service_module.MessageGenerator, "get_response_topic", MagicMock(return_value=topic))
    monkeypatch.setattr(
        service_module,
        "_get_message_context",
        MagicMock(return_value=MessageContext("conv-1", "msg-1", 1700000000)),
    )
    monkeypatch.setattr(service_module, "_load_resumption_context", MagicMock(return_value=None))
    buffer_state = BufferState(
        queue=queue.Queue(),
        stop_event=Event(),
        done_event=Event(),
        task_id_ready=Event(),
        task_id_hint="task-1",
    )
    monkeypatch.setattr(service_module, "_start_buffering", MagicMock(return_value=buffer_state))
    monkeypatch.setattr(service_module, "_resolve_task_id", MagicMock(return_value="task-1"))
    monkeypatch.setattr(
        service_module,
        "_build_snapshot_events",
        MagicMock(return_value=[{"event": StreamEvent.WORKFLOW_FINISHED.value, "task_id": "task-1"}]),
    )

    # Act
    events = list(
        build_workflow_event_stream(
            app_mode=AppMode.ADVANCED_CHAT,
            workflow_run=workflow_run,
            tenant_id="tenant-1",
            app_id="app-1",
            session_maker=MagicMock(),
        )
    )

    # Assert
    assert events[0] == StreamEvent.PING.value
    finished_event = cast(Mapping[str, Any], events[1])
    assert finished_event["event"] == StreamEvent.WORKFLOW_FINISHED.value
    assert buffer_state.stop_event.is_set() is True
    node_repo.get_execution_snapshots_by_workflow_run.assert_called_once()
    called_kwargs = node_repo.get_execution_snapshots_by_workflow_run.call_args.kwargs
    assert called_kwargs["workflow_run_id"] == "run-1"


def test_build_workflow_event_stream_should_emit_periodic_ping_and_stop_after_idle_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    workflow_run = _build_workflow_run_additional(status=WorkflowExecutionStatus.RUNNING)
    topic = _Topic(_StaticSubscription())
    workflow_run_repo = SimpleNamespace(get_workflow_pause=MagicMock())
    node_repo = SimpleNamespace(get_execution_snapshots_by_workflow_run=MagicMock(return_value=[]))
    factory = SimpleNamespace(
        create_api_workflow_run_repository=MagicMock(return_value=workflow_run_repo),
        create_api_workflow_node_execution_repository=MagicMock(return_value=node_repo),
    )
    monkeypatch.setattr(service_module, "DifyAPIRepositoryFactory", factory)
    monkeypatch.setattr(service_module.MessageGenerator, "get_response_topic", MagicMock(return_value=topic))
    monkeypatch.setattr(service_module, "_load_resumption_context", MagicMock(return_value=None))
    monkeypatch.setattr(service_module, "_build_snapshot_events", MagicMock(return_value=[]))
    monkeypatch.setattr(service_module, "_resolve_task_id", MagicMock(return_value="task-1"))

    class AlwaysEmptyQueue:
        def empty(self) -> bool:
            return False

        def get(self, timeout: int = 1) -> None:
            raise queue.Empty

    buffer_state = BufferState(
        queue=AlwaysEmptyQueue(),  # type: ignore[arg-type]
        stop_event=Event(),
        done_event=Event(),
        task_id_ready=Event(),
        task_id_hint="task-1",
    )
    monkeypatch.setattr(service_module, "_start_buffering", MagicMock(return_value=buffer_state))
    time_values = cycle([0.0, 6.0, 21.0, 26.0])
    monkeypatch.setattr(service_module.time, "time", lambda: next(time_values))

    # Act
    events = list(
        build_workflow_event_stream(
            app_mode=AppMode.WORKFLOW,
            workflow_run=workflow_run,
            tenant_id="tenant-1",
            app_id="app-1",
            session_maker=MagicMock(),
            idle_timeout=20.0,
            ping_interval=5.0,
        )
    )

    # Assert
    assert events == [StreamEvent.PING.value, StreamEvent.PING.value]
    assert buffer_state.stop_event.is_set() is True


def test_build_workflow_event_stream_should_exit_when_buffer_done_and_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    workflow_run = _build_workflow_run_additional(status=WorkflowExecutionStatus.RUNNING)
    topic = _Topic(_StaticSubscription())
    workflow_run_repo = SimpleNamespace(get_workflow_pause=MagicMock())
    node_repo = SimpleNamespace(get_execution_snapshots_by_workflow_run=MagicMock(return_value=[]))
    factory = SimpleNamespace(
        create_api_workflow_run_repository=MagicMock(return_value=workflow_run_repo),
        create_api_workflow_node_execution_repository=MagicMock(return_value=node_repo),
    )
    monkeypatch.setattr(service_module, "DifyAPIRepositoryFactory", factory)
    monkeypatch.setattr(service_module.MessageGenerator, "get_response_topic", MagicMock(return_value=topic))
    monkeypatch.setattr(service_module, "_load_resumption_context", MagicMock(return_value=None))
    monkeypatch.setattr(service_module, "_build_snapshot_events", MagicMock(return_value=[]))
    monkeypatch.setattr(service_module, "_resolve_task_id", MagicMock(return_value="task-1"))
    buffer_state = BufferState(
        queue=queue.Queue(),
        stop_event=Event(),
        done_event=Event(),
        task_id_ready=Event(),
        task_id_hint="task-1",
    )
    buffer_state.done_event.set()
    monkeypatch.setattr(service_module, "_start_buffering", MagicMock(return_value=buffer_state))

    # Act
    events = list(
        build_workflow_event_stream(
            app_mode=AppMode.WORKFLOW,
            workflow_run=workflow_run,
            tenant_id="tenant-1",
            app_id="app-1",
            session_maker=MagicMock(),
        )
    )

    # Assert
    assert events == [StreamEvent.PING.value]
    assert buffer_state.stop_event.is_set() is True


def test_build_workflow_event_stream_should_continue_when_pause_loading_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    workflow_run = _build_workflow_run_additional(status=WorkflowExecutionStatus.PAUSED)
    topic = _Topic(_StaticSubscription())
    workflow_run_repo = SimpleNamespace(get_workflow_pause=MagicMock(side_effect=RuntimeError("boom")))
    node_repo = SimpleNamespace(get_execution_snapshots_by_workflow_run=MagicMock(return_value=[]))
    factory = SimpleNamespace(
        create_api_workflow_run_repository=MagicMock(return_value=workflow_run_repo),
        create_api_workflow_node_execution_repository=MagicMock(return_value=node_repo),
    )
    monkeypatch.setattr(service_module, "DifyAPIRepositoryFactory", factory)
    monkeypatch.setattr(service_module.MessageGenerator, "get_response_topic", MagicMock(return_value=topic))
    monkeypatch.setattr(service_module, "_load_resumption_context", MagicMock(return_value=None))
    monkeypatch.setattr(service_module, "_resolve_task_id", MagicMock(return_value="task-1"))
    snapshot_builder = MagicMock(return_value=[{"event": StreamEvent.WORKFLOW_FINISHED.value}])
    monkeypatch.setattr(service_module, "_build_snapshot_events", snapshot_builder)
    buffer_state = BufferState(
        queue=queue.Queue(),
        stop_event=Event(),
        done_event=Event(),
        task_id_ready=Event(),
        task_id_hint="task-1",
    )
    monkeypatch.setattr(service_module, "_start_buffering", MagicMock(return_value=buffer_state))

    # Act
    events = list(
        build_workflow_event_stream(
            app_mode=AppMode.WORKFLOW,
            workflow_run=workflow_run,
            tenant_id="tenant-1",
            app_id="app-1",
            session_maker=MagicMock(),
        )
    )

    # Assert
    assert events[0] == StreamEvent.PING.value
    assert snapshot_builder.call_args.kwargs["pause_entity"] is None
