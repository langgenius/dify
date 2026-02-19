from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask

from controllers.console import wraps as console_wraps
from controllers.console.app import workflow_run as workflow_run_module
from controllers.web.error import NotFoundError
from core.workflow.entities.pause_reason import HumanInputRequired
from core.workflow.enums import WorkflowExecutionStatus
from core.workflow.nodes.human_input.entities import FormInput, UserAction
from core.workflow.nodes.human_input.enums import FormInputType
from libs import login as login_lib
from models.account import Account, AccountStatus, TenantAccountRole
from models.workflow import WorkflowRun


def _make_account() -> Account:
    account = Account(name="tester", email="tester@example.com")
    account.status = AccountStatus.ACTIVE
    account.role = TenantAccountRole.OWNER
    account.id = "account-123"  # type: ignore[assignment]
    account._current_tenant = SimpleNamespace(id="tenant-123")  # type: ignore[attr-defined]
    account._get_current_object = lambda: account  # type: ignore[attr-defined]
    return account


def _patch_console_guards(monkeypatch: pytest.MonkeyPatch, account: Account) -> None:
    monkeypatch.setattr(login_lib.dify_config, "LOGIN_DISABLED", True)
    monkeypatch.setattr(login_lib, "current_user", account)
    monkeypatch.setattr(login_lib, "current_account_with_tenant", lambda: (account, account.current_tenant_id))
    monkeypatch.setattr(login_lib, "check_csrf_token", lambda *_, **__: None)
    monkeypatch.setattr(console_wraps, "current_account_with_tenant", lambda: (account, account.current_tenant_id))
    monkeypatch.setattr(workflow_run_module, "current_user", account)
    monkeypatch.setattr(console_wraps.dify_config, "EDITION", "CLOUD")


class _PauseEntity:
    def __init__(self, paused_at: datetime, reasons: list[HumanInputRequired]):
        self.paused_at = paused_at
        self._reasons = reasons

    def get_pause_reasons(self):
        return self._reasons


def test_pause_details_returns_backstage_input_url(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    account = _make_account()
    _patch_console_guards(monkeypatch, account)
    monkeypatch.setattr(workflow_run_module.dify_config, "APP_WEB_URL", "https://web.example.com")

    workflow_run = Mock(spec=WorkflowRun)
    workflow_run.tenant_id = "tenant-123"
    workflow_run.status = WorkflowExecutionStatus.PAUSED
    workflow_run.created_at = datetime(2024, 1, 1, 12, 0, 0)
    fake_db = SimpleNamespace(engine=Mock(), session=SimpleNamespace(get=lambda *_: workflow_run))
    monkeypatch.setattr(workflow_run_module, "db", fake_db)

    reason = HumanInputRequired(
        form_id="form-1",
        form_content="content",
        inputs=[FormInput(type=FormInputType.TEXT_INPUT, output_variable_name="name")],
        actions=[UserAction(id="approve", title="Approve")],
        node_id="node-1",
        node_title="Ask Name",
        form_token="backstage-token",
    )
    pause_entity = _PauseEntity(paused_at=datetime(2024, 1, 1, 12, 0, 0), reasons=[reason])

    repo = Mock()
    repo.get_workflow_pause.return_value = pause_entity
    monkeypatch.setattr(
        workflow_run_module.DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        lambda *_, **__: repo,
    )

    with app.test_request_context("/console/api/workflow/run-1/pause-details", method="GET"):
        response, status = workflow_run_module.ConsoleWorkflowPauseDetailsApi().get(workflow_run_id="run-1")

    assert status == 200
    assert response["paused_at"] == "2024-01-01T12:00:00Z"
    assert response["paused_nodes"][0]["node_id"] == "node-1"
    assert response["paused_nodes"][0]["pause_type"]["type"] == "human_input"
    assert (
        response["paused_nodes"][0]["pause_type"]["backstage_input_url"]
        == "https://web.example.com/form/backstage-token"
    )
    assert "pending_human_inputs" not in response


def test_pause_details_tenant_isolation(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    account = _make_account()
    _patch_console_guards(monkeypatch, account)
    monkeypatch.setattr(workflow_run_module.dify_config, "APP_WEB_URL", "https://web.example.com")

    workflow_run = Mock(spec=WorkflowRun)
    workflow_run.tenant_id = "tenant-456"
    workflow_run.status = WorkflowExecutionStatus.PAUSED
    workflow_run.created_at = datetime(2024, 1, 1, 12, 0, 0)
    fake_db = SimpleNamespace(engine=Mock(), session=SimpleNamespace(get=lambda *_: workflow_run))
    monkeypatch.setattr(workflow_run_module, "db", fake_db)

    with pytest.raises(NotFoundError):
        with app.test_request_context("/console/api/workflow/run-1/pause-details", method="GET"):
            response, status = workflow_run_module.ConsoleWorkflowPauseDetailsApi().get(workflow_run_id="run-1")
