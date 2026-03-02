from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask

from controllers.console import bp
from controllers.console import wraps as console_wraps
from controllers.console.app import workflow_run as workflow_run_module
from controllers.console.app import wraps as app_wraps
from libs import login as login_lib
from models.account import Account, AccountStatus, TenantAccountRole
from models.model import AppMode

TEST_APP_ID = "550e8400-e29b-41d4-a716-446655440000"


def _make_account() -> Account:
    account = Account(name="tester", email="tester@example.com")
    account.status = AccountStatus.ACTIVE
    account.role = TenantAccountRole.OWNER
    account.id = "account-123"  # type: ignore[assignment]
    account._current_tenant = SimpleNamespace(id="tenant-123")  # type: ignore[attr-defined]
    account._get_current_object = lambda: account  # type: ignore[attr-defined]
    return account


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["SECRET_KEY"] = "test-secret-key"
    app.register_blueprint(bp)
    return app


@pytest.fixture
def client(app: Flask):
    return app.test_client()


@pytest.fixture
def advanced_chat_context(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    account = _make_account()
    app_model = SimpleNamespace(
        id=TEST_APP_ID,
        tenant_id=account.current_tenant_id,
        mode=AppMode.ADVANCED_CHAT.value,
        status="normal",
    )

    monkeypatch.setattr(login_lib.dify_config, "LOGIN_DISABLED", True)
    monkeypatch.setattr(login_lib, "current_user", account)
    monkeypatch.setattr(login_lib, "check_csrf_token", lambda *_, **__: None)
    monkeypatch.setattr(console_wraps.dify_config, "EDITION", "CLOUD")
    monkeypatch.setattr(console_wraps, "current_account_with_tenant", lambda: (account, account.current_tenant_id))
    monkeypatch.setattr(app_wraps, "current_account_with_tenant", lambda: (account, account.current_tenant_id))
    monkeypatch.setattr(app_wraps, "_load_app_model", lambda _app_id: app_model)
    return app_model


def test_advanced_chat_workflow_runs_rejects_rerun_triggered_from(client, advanced_chat_context, monkeypatch):
    service_cls = MagicMock()
    monkeypatch.setattr(workflow_run_module, "WorkflowRunService", service_cls)

    response = client.get(f"/console/api/apps/{TEST_APP_ID}/advanced-chat/workflow-runs?triggered_from=rerun")

    assert response.status_code == 422
    assert response.get_json() == {
        "code": "unsupported_triggered_from",
        "message": "Advanced-chat does not support triggered_from=rerun.",
        "status": 422,
    }
    service_cls.assert_not_called()


def test_advanced_chat_workflow_runs_count_rejects_rerun_triggered_from(client, advanced_chat_context, monkeypatch):
    service_cls = MagicMock()
    monkeypatch.setattr(workflow_run_module, "WorkflowRunService", service_cls)

    response = client.get(f"/console/api/apps/{TEST_APP_ID}/advanced-chat/workflow-runs/count?triggered_from=rerun")

    assert response.status_code == 422
    assert response.get_json() == {
        "code": "unsupported_triggered_from",
        "message": "Advanced-chat does not support triggered_from=rerun.",
        "status": 422,
    }
    service_cls.assert_not_called()


def test_common_workflow_runs_rejects_rerun_triggered_from_for_advanced_chat(
    client, advanced_chat_context, monkeypatch
):
    service_cls = MagicMock()
    monkeypatch.setattr(workflow_run_module, "WorkflowRunService", service_cls)

    response = client.get(f"/console/api/apps/{TEST_APP_ID}/workflow-runs?triggered_from=rerun")

    assert response.status_code == 422
    assert response.get_json() == {
        "code": "unsupported_triggered_from",
        "message": "Advanced-chat does not support triggered_from=rerun.",
        "status": 422,
    }
    service_cls.assert_not_called()


def test_common_workflow_runs_count_rejects_rerun_triggered_from_for_advanced_chat(
    client,
    advanced_chat_context,
    monkeypatch,
):
    service_cls = MagicMock()
    monkeypatch.setattr(workflow_run_module, "WorkflowRunService", service_cls)

    response = client.get(f"/console/api/apps/{TEST_APP_ID}/workflow-runs/count?triggered_from=rerun")

    assert response.status_code == 422
    assert response.get_json() == {
        "code": "unsupported_triggered_from",
        "message": "Advanced-chat does not support triggered_from=rerun.",
        "status": 422,
    }
    service_cls.assert_not_called()
