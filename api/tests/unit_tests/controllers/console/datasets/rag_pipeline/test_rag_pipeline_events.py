from datetime import datetime
from inspect import unwrap
from types import SimpleNamespace
from typing import cast
from unittest.mock import Mock

import pytest
from flask import Flask
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import NotFound

from controllers.console.datasets.rag_pipeline import rag_pipeline_workflow as module
from models import Account
from models.dataset import Pipeline
from models.workflow import WorkflowRun


def _account(account_id: str = "account-1") -> Account:
    return cast(Account, SimpleNamespace(id=account_id))


def _pipeline() -> Pipeline:
    return cast(Pipeline, SimpleNamespace(id="pipeline-1", tenant_id="tenant-1"))


def _workflow_run(**overrides: object) -> WorkflowRun:
    values: dict[str, object] = {
        "id": "run-1",
        "app_id": "pipeline-1",
        "tenant_id": "tenant-1",
        "created_by_role": module.CreatorUserRole.ACCOUNT,
        "created_by": "account-1",
        "finished_at": None,
    }
    values.update(overrides)
    return cast(WorkflowRun, SimpleNamespace(**values))


@pytest.fixture(autouse=True)
def _patch_database(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> None:
    monkeypatch.setattr(module, "db", SimpleNamespace(engine=sqlite_engine, session=Mock(return_value=Mock())))


def _patch_service(monkeypatch: pytest.MonkeyPatch, workflow_run: WorkflowRun | None) -> Mock:
    service = Mock()
    service.session_maker = sessionmaker()
    service.get_rag_pipeline_workflow_run.return_value = workflow_run
    monkeypatch.setattr(module, "RagPipelineService", Mock(return_value=service))
    return service


@pytest.mark.parametrize(
    "workflow_run",
    [
        None,
        _workflow_run(app_id="pipeline-2"),
        _workflow_run(created_by_role=module.CreatorUserRole.END_USER),
        _workflow_run(created_by="account-2"),
    ],
)
def test_rag_events_rejects_missing_or_cross_owner_run(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    workflow_run: WorkflowRun | None,
) -> None:
    _patch_service(monkeypatch, workflow_run)
    api = module.RagPipelineWorkflowRunEventsApi()
    handler = unwrap(api.get)

    with app.test_request_context("/rag/pipelines/pipeline-1/workflow-runs/run-1/events"):
        with pytest.raises(NotFound, match="Workflow run not found"):
            handler(api, _account(), _pipeline(), "run-1")


def test_rag_events_replays_from_last_event_id(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_service(monkeypatch, _workflow_run())
    build_stream = Mock(return_value=iter([{"event": "workflow_finished"}]))
    monkeypatch.setattr(
        module,
        "build_workflow_event_stream",
        build_stream,
    )
    api = module.RagPipelineWorkflowRunEventsApi()
    handler = unwrap(api.get)

    with app.test_request_context(
        "/rag/pipelines/pipeline-1/workflow-runs/run-1/events",
        headers={"Last-Event-ID": "123-4"},
    ):
        response = handler(api, _account(), _pipeline(), "run-1")
        assert '"workflow_finished"' in response.get_data(as_text=True)

    assert build_stream.call_args.kwargs["cursor"] == "123-4"


def test_rag_events_uses_rag_snapshot_and_keeps_multi_pause_stream_open(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workflow_run = _workflow_run()
    _patch_service(monkeypatch, workflow_run)
    build_stream = Mock(return_value=iter([{"event": "workflow_started"}]))
    monkeypatch.setattr(module, "build_workflow_event_stream", build_stream)
    api = module.RagPipelineWorkflowRunEventsApi()
    handler = unwrap(api.get)

    with app.test_request_context(
        "/rag/pipelines/pipeline-1/workflow-runs/run-1/events?include_state_snapshot=true&continue_on_pause=true"
    ):
        response = handler(api, _account(), _pipeline(), "run-1")
        assert '"workflow_started"' in response.get_data(as_text=True)

    kwargs = build_stream.call_args.kwargs
    assert kwargs["app_mode"] == module.AppMode.RAG_PIPELINE
    assert kwargs["workflow_run"] is workflow_run
    assert kwargs["tenant_id"] == "tenant-1"
    assert kwargs["app_id"] == "pipeline-1"
    assert kwargs["human_input_surface"] == module.HumanInputSurface.CONSOLE
    assert kwargs["close_on_pause"] is False


def test_rag_events_finished_shortcut_uses_persisted_task_id(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workflow_run = _workflow_run(finished_at=datetime(2026, 7, 28, 12, 0, 0))
    _patch_service(monkeypatch, workflow_run)
    finished = Mock()
    finished.event.value = "workflow_finished"
    finished.model_dump.return_value = {"event": "workflow_finished", "task_id": "task-1"}
    converter = Mock(return_value=finished)
    resolve_task_id = Mock(return_value="task-1")
    monkeypatch.setattr(module, "resolve_workflow_event_task_id", resolve_task_id)
    monkeypatch.setattr(module.WorkflowResponseConverter, "workflow_run_result_to_finish_response", converter)
    api = module.RagPipelineWorkflowRunEventsApi()
    handler = unwrap(api.get)

    with app.test_request_context("/rag/pipelines/pipeline-1/workflow-runs/run-1/events"):
        response = handler(api, _account(), _pipeline(), "run-1")

    assert '"task_id": "task-1"' in response.get_data(as_text=True)
    assert converter.call_args.kwargs["workflow_run"] is workflow_run
    assert resolve_task_id.call_args.kwargs["workflow_run"] is workflow_run
    assert isinstance(resolve_task_id.call_args.kwargs["session_maker"], sessionmaker)
