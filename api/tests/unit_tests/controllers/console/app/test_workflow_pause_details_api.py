from __future__ import annotations

import inspect
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask

from controllers.common.errors import NotFoundError
from controllers.console.app import workflow_run as workflow_run_module
from core.workflow.human_input import session_binding
from graphon.entities.pause_reason import HumanInputRequired
from graphon.enums import WorkflowExecutionStatus
from graphon.nodes.human_input.entities import ParagraphInputConfig, UserActionConfig
from models.workflow import WorkflowRun


class _PauseEntity:
    def __init__(self, paused_at: datetime, reasons: list[HumanInputRequired]):
        self.paused_at = paused_at
        self._reasons = reasons

    def get_pause_reasons(self):
        return self._reasons


def test_pause_details_resolves_session_id_before_loading_tokens(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(workflow_run_module.dify_config, "APP_WEB_URL", "https://web.example.com")

    workflow_run = Mock(spec=WorkflowRun)
    workflow_run.tenant_id = "tenant-123"
    workflow_run.status = WorkflowExecutionStatus.PAUSED
    workflow_run.created_at = datetime(2024, 1, 1, 12, 0, 0)
    fake_db = SimpleNamespace(engine=Mock(), session=SimpleNamespace(get=lambda *_: workflow_run))
    monkeypatch.setattr(workflow_run_module, "db", fake_db)

    reason = HumanInputRequired(
        form_id="session-1",
        form_content="content",
        inputs=[ParagraphInputConfig(output_variable_name="name")],
        actions=[UserActionConfig(id="approve", title="Approve")],
        node_id="node-1",
        node_title="Ask Name",
    )
    pause_entity = _PauseEntity(paused_at=datetime(2024, 1, 1, 12, 0, 0), reasons=[reason])

    repo = Mock()
    repo.get_workflow_pause.return_value = pause_entity
    monkeypatch.setattr(
        workflow_run_module.DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        lambda *_, **__: repo,
    )
    monkeypatch.setattr(
        session_binding,
        "resolve_form_id_from_session_id",
        lambda *, session_id: "form-1" if session_id == "session-1" else pytest.fail(f"unexpected session_id: {session_id}"),
    )
    monkeypatch.setattr(
        workflow_run_module,
        "_load_form_tokens_by_form_id",
        lambda form_ids: (
            pytest.fail(f"expected resolved form id, got: {form_ids}")
            if form_ids != ["form-1"]
            else {"form-1": "backstage-token"}
        ),
    )

    with app.test_request_context("/console/api/workflow/run-1/pause-details", method="GET"):
        handler = inspect.unwrap(workflow_run_module.ConsoleWorkflowPauseDetailsApi.get)
        response, status = handler(
            workflow_run_module.ConsoleWorkflowPauseDetailsApi(),
            "tenant-123",
            workflow_run_id="run-1",
        )

    assert status == 200
    assert response["paused_at"] == "2024-01-01T12:00:00Z"
    assert response["paused_nodes"][0]["node_id"] == "node-1"
    assert response["paused_nodes"][0]["pause_type"]["type"] == "human_input"
    assert (
        response["paused_nodes"][0]["pause_type"]["backstage_input_url"]
        == "https://web.example.com/form/backstage-token"
    )
    assert response["paused_nodes"][0]["pause_type"]["form_id"] == "session-1"
    assert "pending_human_inputs" not in response


def test_pause_details_tenant_isolation(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(workflow_run_module.dify_config, "APP_WEB_URL", "https://web.example.com")

    workflow_run = Mock(spec=WorkflowRun)
    workflow_run.tenant_id = "tenant-456"
    workflow_run.status = WorkflowExecutionStatus.PAUSED
    workflow_run.created_at = datetime(2024, 1, 1, 12, 0, 0)
    fake_db = SimpleNamespace(engine=Mock(), session=SimpleNamespace(get=lambda *_: workflow_run))
    monkeypatch.setattr(workflow_run_module, "db", fake_db)

    handler = inspect.unwrap(workflow_run_module.ConsoleWorkflowPauseDetailsApi.get)
    with app.test_request_context("/console/api/workflow/run-1/pause-details", method="GET"):
        with pytest.raises(NotFoundError):
            handler(
                workflow_run_module.ConsoleWorkflowPauseDetailsApi(),
                "tenant-123",
                workflow_run_id="run-1",
            )


def test_pause_details_returns_empty_response_for_non_paused_run(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow_run = Mock(spec=WorkflowRun)
    workflow_run.tenant_id = "tenant-123"
    workflow_run.status = WorkflowExecutionStatus.RUNNING
    fake_db = SimpleNamespace(engine=Mock(), session=SimpleNamespace(get=lambda *_: workflow_run))
    monkeypatch.setattr(workflow_run_module, "db", fake_db)

    with app.test_request_context("/console/api/workflow/run-1/pause-details", method="GET"):
        handler = inspect.unwrap(workflow_run_module.ConsoleWorkflowPauseDetailsApi.get)
        response, status = handler(
            workflow_run_module.ConsoleWorkflowPauseDetailsApi(),
            "tenant-123",
            workflow_run_id="run-1",
        )

    assert status == 200
    assert response == {"paused_at": None, "paused_nodes": []}


def test_pause_details_response_schema_is_registered() -> None:
    assert workflow_run_module.WorkflowPauseDetailsResponse.__name__ in workflow_run_module.console_ns.models
