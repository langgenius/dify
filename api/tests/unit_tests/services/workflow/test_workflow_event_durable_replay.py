from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.app.entities.task_entities import StreamEvent
from graphon.enums import WorkflowExecutionStatus
from models.enums import WorkflowRunTriggeredFrom
from models.model import AppMode
from models.workflow import WorkflowNodeExecutionTriggeredFrom
from services import workflow_event_snapshot_service as service


class _ReplayTopic:
    def __init__(self, latest_cursor: str | None, earliest_cursor: str | None = "1-0") -> None:
        self._latest_cursor = latest_cursor
        self._earliest_cursor = earliest_cursor if latest_cursor is not None else None

    def earliest_cursor(self) -> str | None:
        return self._earliest_cursor

    def latest_cursor(self) -> str | None:
        return self._latest_cursor


def test_retained_log_is_primary_and_skips_synthetic_snapshot(monkeypatch) -> None:
    topic = _ReplayTopic("12-0")
    stream = iter([{"event": StreamEvent.WORKFLOW_FINISHED.value}])
    stream_topic_events = MagicMock(return_value=stream)
    repository_factory = MagicMock()
    monkeypatch.setattr(service.MessageGenerator, "get_response_topic", MagicMock(return_value=topic))
    monkeypatch.setattr(service, "stream_topic_events", stream_topic_events)
    monkeypatch.setattr(service, "DifyAPIRepositoryFactory", repository_factory)

    result = service.build_workflow_event_stream(
        app_mode=AppMode.WORKFLOW,
        workflow_run=SimpleNamespace(id="run-1"),
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


def test_explicit_cursor_never_mixes_in_snapshot_events(monkeypatch) -> None:
    topic = _ReplayTopic("12-0")
    stream = iter([{"event": StreamEvent.WORKFLOW_FINISHED.value}])
    stream_topic_events = MagicMock(return_value=stream)
    repository_factory = MagicMock()
    monkeypatch.setattr(service.MessageGenerator, "get_response_topic", MagicMock(return_value=topic))
    monkeypatch.setattr(service, "stream_topic_events", stream_topic_events)
    monkeypatch.setattr(service, "DifyAPIRepositoryFactory", repository_factory)

    result = service.build_workflow_event_stream(
        app_mode=AppMode.WORKFLOW,
        workflow_run=SimpleNamespace(
            id="run-1",
            status=WorkflowExecutionStatus.RUNNING,
            finished_at=None,
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


def test_running_run_with_expired_cursor_reconstructs_snapshot_before_future_events(monkeypatch) -> None:
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
        workflow_run=SimpleNamespace(
            id="run-1",
            workflow_id="workflow-1",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            status=WorkflowExecutionStatus.RUNNING,
            finished_at=None,
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


def test_cursor_older_than_retained_window_reconstructs_snapshot(monkeypatch) -> None:
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
        workflow_run=SimpleNamespace(
            id="run-1",
            workflow_id="workflow-1",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            status=WorkflowExecutionStatus.RUNNING,
        ),
        tenant_id="tenant-1",
        app_id="app-1",
        session_maker=MagicMock(),
        cursor="10-0",
    )

    stream_topic_events.assert_not_called()
    repository_factory.create_api_workflow_run_repository.assert_called_once()
    result.close()


def test_snapshot_uses_latest_handoff_entity_for_single_step_node_lookup(monkeypatch) -> None:
    topic = _ReplayTopic(None)
    workflow_run = SimpleNamespace(
        id="run-1",
        workflow_id="workflow-1",
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        status=WorkflowExecutionStatus.RUNNING,
    )
    latest_handoff = SimpleNamespace(task_id="handoff-task")
    handoff_context = SimpleNamespace(
        get_generate_entity=lambda: SimpleNamespace(single_iteration_run=object(), single_loop_run=None)
    )
    workflow_run_repository = MagicMock()
    node_repository = MagicMock()
    node_repository.get_execution_snapshots_by_workflow_run.return_value = []
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
    workflow_run = SimpleNamespace(
        id="run-1",
        triggered_from=WorkflowRunTriggeredFrom.RAG_PIPELINE_DEBUGGING,
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
def test_each_single_step_entity_uses_single_step_node_lookup(single_iteration_run, single_loop_run) -> None:
    workflow_run = SimpleNamespace(
        id="run-1",
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
    )
    resumption_context = SimpleNamespace(
        get_generate_entity=lambda: SimpleNamespace(
            single_iteration_run=single_iteration_run,
            single_loop_run=single_loop_run,
        )
    )

    result = service._resolve_node_execution_triggered_from(
        workflow_run=workflow_run,
        resumption_context=resumption_context,
    )

    assert result == WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP


def test_node_lookup_source_defaults_to_workflow_run() -> None:
    workflow_run = SimpleNamespace(
        id="run-1",
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
    )

    result = service._resolve_node_execution_triggered_from(
        workflow_run=workflow_run,
        resumption_context=None,
    )

    assert result == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN


def test_explicit_node_lookup_source_supports_rag_single_step() -> None:
    workflow_run = SimpleNamespace(
        id="run-1",
        triggered_from=WorkflowRunTriggeredFrom.RAG_PIPELINE_RUN,
    )

    result = service._resolve_node_execution_triggered_from(
        workflow_run=workflow_run,
        resumption_context=None,
        override=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
    )

    assert result == WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP


def test_finished_event_task_id_prefers_latest_handoff(monkeypatch) -> None:
    latest_handoff = SimpleNamespace(task_id="handoff-task")
    monkeypatch.setattr(service, "_get_latest_workflow_handoff", MagicMock(return_value=latest_handoff))

    task_id = service.resolve_workflow_event_task_id(
        workflow_run=SimpleNamespace(id="run-1"),
        session_maker=MagicMock(),
    )

    assert task_id == "handoff-task"
