from __future__ import annotations

from types import SimpleNamespace
from typing import cast, override
from unittest.mock import MagicMock

import pytest

from core.app.apps.streaming_utils import StreamEventWithCursor
from core.app.entities.task_entities import StreamEvent
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext
from graphon.enums import WorkflowExecutionStatus
from libs.broadcast_channel.channel import CursorMessage, Topic
from libs.broadcast_channel.exc import SubscriptionClosedError
from models.enums import WorkflowRunTriggeredFrom
from models.model import AppMode
from models.workflow import WorkflowNodeExecutionTriggeredFrom, WorkflowRun
from models.workflow_handoff import WorkflowRunHandoff
from services import workflow_event_snapshot_service as service


class _ReplayTopic:
    def __init__(self, latest_cursor: str | None, earliest_cursor: str | None = "1-0") -> None:
        self._latest_cursor = latest_cursor
        self._earliest_cursor = earliest_cursor if latest_cursor is not None else None

    def earliest_cursor(self) -> str | None:
        return self._earliest_cursor

    def latest_cursor(self) -> str | None:
        return self._latest_cursor


def test_retained_log_is_primary_and_skips_synthetic_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    topic = _ReplayTopic("12-0")
    stream = iter([{"event": StreamEvent.WORKFLOW_FINISHED.value}])
    stream_topic_events = MagicMock(return_value=stream)
    repository_factory = MagicMock()
    monkeypatch.setattr(service.MessageGenerator, "get_response_topic", MagicMock(return_value=topic))
    monkeypatch.setattr(service, "stream_topic_events", stream_topic_events)
    monkeypatch.setattr(service, "DifyAPIRepositoryFactory", repository_factory)

    result = service.build_workflow_event_stream(
        app_mode=AppMode.WORKFLOW,
        workflow_run=cast(WorkflowRun, SimpleNamespace(id="run-1")),
        tenant_id="tenant-1",
        app_id="app-1",
        session_maker=MagicMock(),
    )

    assert result is stream
    stream_topic_events.assert_called_once_with(
        topic=topic,
        idle_timeout=300,
        ping_interval=10.0,
        terminal_events=None,
        cursor="0-0",
    )
    repository_factory.create_api_workflow_run_repository.assert_not_called()


def test_retained_log_wins_when_events_arrive_during_snapshot_query(monkeypatch: pytest.MonkeyPatch) -> None:
    class _RaceTopic(_ReplayTopic):
        def __init__(self) -> None:
            super().__init__(None)
            self._calls = 0

        @override
        def latest_cursor(self) -> str | None:
            self._calls += 1
            return None if self._calls == 1 else "1-0"

    topic = _RaceTopic()
    replayed_events = [{"event": StreamEvent.WORKFLOW_FINISHED.value}]
    stream_topic_events = MagicMock(return_value=iter(replayed_events))
    repository_factory = MagicMock()
    node_repository = repository_factory.create_api_workflow_node_execution_repository.return_value
    node_snapshots: list[object] = []
    node_repository.get_execution_snapshots_by_workflow_run.return_value = node_snapshots
    monkeypatch.setattr(service.MessageGenerator, "get_response_topic", MagicMock(return_value=topic))
    monkeypatch.setattr(service, "stream_topic_events", stream_topic_events)
    monkeypatch.setattr(service, "DifyAPIRepositoryFactory", repository_factory)
    monkeypatch.setattr(service, "_get_latest_workflow_handoff", MagicMock(return_value=None))

    result = service.build_workflow_event_stream(
        app_mode=AppMode.WORKFLOW,
        workflow_run=cast(
            WorkflowRun,
            SimpleNamespace(
                id="run-1",
                workflow_id="workflow-1",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                status=WorkflowExecutionStatus.RUNNING,
            ),
        ),
        tenant_id="tenant-1",
        app_id="app-1",
        session_maker=MagicMock(),
    )

    assert list(result) == replayed_events
    stream_topic_events.assert_called_once_with(
        topic=topic,
        idle_timeout=300,
        ping_interval=10.0,
        terminal_events=None,
        cursor="0-0",
    )


def test_explicit_cursor_never_mixes_in_snapshot_events(monkeypatch: pytest.MonkeyPatch) -> None:
    topic = _ReplayTopic("12-0")
    stream = iter([{"event": StreamEvent.WORKFLOW_FINISHED.value}])
    stream_topic_events = MagicMock(return_value=stream)
    repository_factory = MagicMock()
    monkeypatch.setattr(service.MessageGenerator, "get_response_topic", MagicMock(return_value=topic))
    monkeypatch.setattr(service, "stream_topic_events", stream_topic_events)
    monkeypatch.setattr(service, "DifyAPIRepositoryFactory", repository_factory)

    result = service.build_workflow_event_stream(
        app_mode=AppMode.WORKFLOW,
        workflow_run=cast(
            WorkflowRun,
            SimpleNamespace(
                id="run-1",
                status=WorkflowExecutionStatus.RUNNING,
                finished_at=None,
            ),
        ),
        tenant_id="tenant-1",
        app_id="app-1",
        session_maker=MagicMock(),
        close_on_pause=False,
        cursor="10-0",
    )

    assert result is stream
    stream_topic_events.assert_called_once_with(
        topic=topic,
        idle_timeout=300,
        ping_interval=10.0,
        terminal_events=[StreamEvent.WORKFLOW_FINISHED],
        cursor="10-0",
    )
    repository_factory.create_api_workflow_run_repository.assert_not_called()


def test_paused_tail_cursor_can_stay_open_until_workflow_finished(monkeypatch: pytest.MonkeyPatch) -> None:
    topic = _ReplayTopic("12-0")
    replayed_events = [
        {"event": StreamEvent.HUMAN_INPUT_FORM_FILLED.value},
        {"event": StreamEvent.WORKFLOW_FINISHED.value},
    ]
    stream = iter(replayed_events)
    stream_topic_events = MagicMock(return_value=stream)
    repository_factory = MagicMock()
    monkeypatch.setattr(service.MessageGenerator, "get_response_topic", MagicMock(return_value=topic))
    monkeypatch.setattr(service, "stream_topic_events", stream_topic_events)
    monkeypatch.setattr(service, "DifyAPIRepositoryFactory", repository_factory)

    result = service.build_workflow_event_stream(
        app_mode=AppMode.WORKFLOW,
        workflow_run=cast(
            WorkflowRun,
            SimpleNamespace(
                id="run-1",
                status=WorkflowExecutionStatus.PAUSED,
                finished_at=None,
            ),
        ),
        tenant_id="tenant-1",
        app_id="app-1",
        session_maker=MagicMock(),
        close_on_pause=False,
        cursor="12-0",
    )

    assert list(result) == replayed_events
    stream_topic_events.assert_called_once_with(
        topic=topic,
        idle_timeout=300,
        ping_interval=10.0,
        terminal_events=[StreamEvent.WORKFLOW_FINISHED],
        cursor="12-0",
    )
    repository_factory.create_api_workflow_run_repository.assert_not_called()


def test_running_run_with_expired_cursor_reconstructs_snapshot_before_future_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    topic = _ReplayTopic(None)
    stream_topic_events = MagicMock()
    repository_factory = MagicMock()
    repository_factory.create_api_workflow_run_repository.return_value = MagicMock()
    repository_factory.create_api_workflow_node_execution_repository.return_value = MagicMock(
        get_execution_snapshots_by_workflow_run=MagicMock(return_value=[])
    )
    monkeypatch.setattr(service.MessageGenerator, "get_response_topic", MagicMock(return_value=topic))
    monkeypatch.setattr(service, "stream_topic_events", stream_topic_events)
    monkeypatch.setattr(service, "DifyAPIRepositoryFactory", repository_factory)
    monkeypatch.setattr(service, "_get_latest_workflow_handoff", MagicMock(return_value=None))

    result = service.build_workflow_event_stream(
        app_mode=AppMode.WORKFLOW,
        workflow_run=cast(
            WorkflowRun,
            SimpleNamespace(
                id="run-1",
                workflow_id="workflow-1",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                status=WorkflowExecutionStatus.RUNNING,
                finished_at=None,
            ),
        ),
        tenant_id="tenant-1",
        app_id="app-1",
        session_maker=MagicMock(),
        cursor="10-0",
    )

    assert result is not stream_topic_events.return_value
    stream_topic_events.assert_not_called()
    repository_factory.create_api_workflow_run_repository.assert_called_once()
    repository_factory.create_api_workflow_node_execution_repository.assert_called_once()
    result.close()


def test_cursor_older_than_retained_window_reconstructs_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    topic = _ReplayTopic("20-0", earliest_cursor="12-0")
    repository_factory = MagicMock()
    repository_factory.create_api_workflow_run_repository.return_value = MagicMock()
    repository_factory.create_api_workflow_node_execution_repository.return_value = MagicMock(
        get_execution_snapshots_by_workflow_run=MagicMock(return_value=[])
    )
    stream_topic_events = MagicMock()
    monkeypatch.setattr(service.MessageGenerator, "get_response_topic", MagicMock(return_value=topic))
    monkeypatch.setattr(service, "stream_topic_events", stream_topic_events)
    monkeypatch.setattr(service, "DifyAPIRepositoryFactory", repository_factory)
    monkeypatch.setattr(service, "_get_latest_workflow_handoff", MagicMock(return_value=None))

    result = service.build_workflow_event_stream(
        app_mode=AppMode.WORKFLOW,
        workflow_run=cast(
            WorkflowRun,
            SimpleNamespace(
                id="run-1",
                workflow_id="workflow-1",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                status=WorkflowExecutionStatus.RUNNING,
            ),
        ),
        tenant_id="tenant-1",
        app_id="app-1",
        session_maker=MagicMock(),
        cursor="10-0",
    )

    stream_topic_events.assert_not_called()
    repository_factory.create_api_workflow_run_repository.assert_called_once()
    result.close()


def test_snapshot_uses_latest_handoff_entity_for_single_step_node_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    topic = _ReplayTopic(None)
    workflow_run = cast(
        WorkflowRun,
        SimpleNamespace(
            id="run-1",
            workflow_id="workflow-1",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            status=WorkflowExecutionStatus.RUNNING,
        ),
    )
    latest_handoff = SimpleNamespace(task_id="handoff-task")
    handoff_context = SimpleNamespace(
        get_generate_entity=lambda: SimpleNamespace(single_iteration_run=object(), single_loop_run=None)
    )
    workflow_run_repository = MagicMock()
    node_repository = MagicMock()
    node_snapshots: list[object] = []
    node_repository.get_execution_snapshots_by_workflow_run.return_value = node_snapshots
    repository_factory = MagicMock()
    repository_factory.create_api_workflow_run_repository.return_value = workflow_run_repository
    repository_factory.create_api_workflow_node_execution_repository.return_value = node_repository
    monkeypatch.setattr(service.MessageGenerator, "get_response_topic", MagicMock(return_value=topic))
    monkeypatch.setattr(service, "DifyAPIRepositoryFactory", repository_factory)
    monkeypatch.setattr(service, "_get_latest_workflow_handoff", MagicMock(return_value=latest_handoff))
    load_handoff_context = MagicMock(return_value=handoff_context)
    monkeypatch.setattr(service, "_load_handoff_resumption_context", load_handoff_context)

    service.build_workflow_event_stream(
        app_mode=AppMode.WORKFLOW,
        workflow_run=workflow_run,
        tenant_id="tenant-1",
        app_id="app-1",
        session_maker=MagicMock(),
    )

    load_handoff_context.assert_called_once()
    node_repository.get_execution_snapshots_by_workflow_run.assert_called_once_with(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        workflow_run_id="run-1",
    )


def test_node_lookup_source_falls_back_to_full_rag_run_trigger() -> None:
    workflow_run = cast(
        WorkflowRun,
        SimpleNamespace(
            id="run-1",
            triggered_from=WorkflowRunTriggeredFrom.RAG_PIPELINE_DEBUGGING,
        ),
    )

    result = service._resolve_node_execution_triggered_from(
        workflow_run=workflow_run,
        resumption_context=None,
    )

    assert result == WorkflowNodeExecutionTriggeredFrom.RAG_PIPELINE_RUN


@pytest.mark.parametrize(
    ("single_iteration_run", "single_loop_run"),
    [(object(), None), (None, object())],
)
def test_each_single_step_entity_uses_single_step_node_lookup(
    single_iteration_run: object | None,
    single_loop_run: object | None,
) -> None:
    workflow_run = cast(
        WorkflowRun,
        SimpleNamespace(
            id="run-1",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        ),
    )
    resumption_context = cast(
        WorkflowResumptionContext,
        SimpleNamespace(
            get_generate_entity=lambda: SimpleNamespace(
                single_iteration_run=single_iteration_run,
                single_loop_run=single_loop_run,
            )
        ),
    )

    result = service._resolve_node_execution_triggered_from(
        workflow_run=workflow_run,
        resumption_context=resumption_context,
    )

    assert result == WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP


def test_node_lookup_source_defaults_to_workflow_run() -> None:
    workflow_run = cast(
        WorkflowRun,
        SimpleNamespace(
            id="run-1",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        ),
    )

    result = service._resolve_node_execution_triggered_from(
        workflow_run=workflow_run,
        resumption_context=None,
    )

    assert result == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN


def test_explicit_node_lookup_source_supports_rag_single_step() -> None:
    workflow_run = cast(
        WorkflowRun,
        SimpleNamespace(
            id="run-1",
            triggered_from=WorkflowRunTriggeredFrom.RAG_PIPELINE_RUN,
        ),
    )

    result = service._resolve_node_execution_triggered_from(
        workflow_run=workflow_run,
        resumption_context=None,
        override=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
    )

    assert result == WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP


def test_finished_event_task_id_prefers_latest_handoff(monkeypatch: pytest.MonkeyPatch) -> None:
    latest_handoff = SimpleNamespace(task_id="handoff-task")
    monkeypatch.setattr(service, "_get_latest_workflow_handoff", MagicMock(return_value=latest_handoff))

    task_id = service.resolve_workflow_event_task_id(
        workflow_run=cast(WorkflowRun, SimpleNamespace(id="run-1")),
        session_maker=MagicMock(),
    )

    assert task_id == "handoff-task"


def test_retained_topic_inspection_failures_fall_back_to_snapshot(caplog: pytest.LogCaptureFixture) -> None:
    class _BrokenTopic:
        def earliest_cursor(self) -> str | None:
            raise RuntimeError("earliest unavailable")

        def latest_cursor(self) -> str | None:
            raise RuntimeError("latest unavailable")

    topic = _BrokenTopic()

    assert service._topic_has_retained_events(cast(Topic, topic)) is False
    assert service._topic_retained_cursor_window(cast(Topic, topic)) is None
    assert "Failed to inspect retained workflow events" in caplog.text
    assert "Failed to inspect retained workflow event cursor window" in caplog.text


def test_retained_cursor_window_handles_latest_cursor_failure() -> None:
    class _BrokenLatestTopic:
        def earliest_cursor(self) -> str | None:
            return "1-0"

        def latest_cursor(self) -> str | None:
            raise RuntimeError("latest unavailable")

    assert service._topic_retained_cursor_window(cast(Topic, _BrokenLatestTopic())) is None


def test_load_handoff_resumption_context_decodes_verified_state(monkeypatch: pytest.MonkeyPatch) -> None:
    repository = object()
    handoff_service = MagicMock()
    handoff_service.load_and_verify_state.return_value = b"serialized-state"
    repository_factory = MagicMock(return_value=repository)
    service_factory = MagicMock(return_value=handoff_service)
    expected_context = cast(WorkflowResumptionContext, object())
    loads = MagicMock(return_value=expected_context)
    monkeypatch.setattr(service, "SQLAlchemyWorkflowRunHandoffRepository", repository_factory)
    monkeypatch.setattr(service, "WorkflowHandoffService", service_factory)
    monkeypatch.setattr(service.WorkflowResumptionContext, "loads", loads)
    handoff = cast(
        WorkflowRunHandoff,
        SimpleNamespace(id="handoff-1", workflow_run_id="run-1", generation=2),
    )
    session_maker = MagicMock()

    result = service._load_handoff_resumption_context(
        session_maker=session_maker,
        handoff=handoff,
    )

    assert result is expected_context
    repository_factory.assert_called_once_with(session_maker)
    service_factory.assert_called_once_with(repository=repository, storage=service.storage)
    handoff_service.load_and_verify_state.assert_called_once_with(handoff)
    loads.assert_called_once_with("serialized-state")


def test_load_handoff_resumption_context_tolerates_missing_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    handoff_service = MagicMock()
    handoff_service.load_and_verify_state.side_effect = FileNotFoundError("snapshot collected")
    monkeypatch.setattr(service, "SQLAlchemyWorkflowRunHandoffRepository", MagicMock())
    monkeypatch.setattr(service, "WorkflowHandoffService", MagicMock(return_value=handoff_service))
    handoff = cast(
        WorkflowRunHandoff,
        SimpleNamespace(id="handoff-1", workflow_run_id="run-1", generation=2),
    )

    result = service._load_handoff_resumption_context(
        session_maker=MagicMock(),
        handoff=handoff,
    )

    assert result is None
    assert "Failed to load workflow handoff context for event snapshot" in caplog.text


def test_node_lookup_tolerates_invalid_resumption_context_and_trigger_source(
    caplog: pytest.LogCaptureFixture,
) -> None:
    resumption_context = MagicMock()
    resumption_context.get_generate_entity.side_effect = ValueError("incompatible state")
    workflow_run = cast(
        WorkflowRun,
        SimpleNamespace(id="run-1", triggered_from="future-trigger"),
    )

    result = service._resolve_node_execution_triggered_from(
        workflow_run=workflow_run,
        resumption_context=resumption_context,
    )

    assert result == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
    assert "Failed to inspect workflow resumption context" in caplog.text
    assert "Unknown workflow run trigger source" in caplog.text


def test_cursor_buffer_preserves_cursor_and_stops_cleanly() -> None:
    class _CursorSubscription:
        def __init__(self) -> None:
            self._delivered = False

        def receive_with_cursor(self, timeout: float | None = 0.1) -> CursorMessage | None:
            assert timeout == 1
            if not self._delivered:
                self._delivered = True
                return CursorMessage(
                    payload=b'{"event":"workflow_finished","task_id":"task-1"}',
                    cursor="9-2",
                )
            raise SubscriptionClosedError()

    buffer_state = service._start_buffering(_CursorSubscription())

    assert buffer_state.task_id_ready.wait(timeout=1) is True
    buffered_event = buffer_state.queue.get(timeout=1)
    assert buffer_state.done_event.wait(timeout=1) is True
    assert isinstance(buffered_event, StreamEventWithCursor)
    assert buffered_event.cursor == "9-2"
    assert buffered_event.event["task_id"] == "task-1"
    assert service._is_terminal_event(buffered_event, close_on_pause=False) is True
