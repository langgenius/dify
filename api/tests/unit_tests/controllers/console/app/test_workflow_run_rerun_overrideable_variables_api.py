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
from services.workflow_run_rerun_service import WorkflowRunRerunServiceError

TEST_APP_ID = "550e8400-e29b-41d4-a716-446655440000"
TEST_RUN_ID = "11111111-1111-1111-1111-111111111111"


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
def workflow_context(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    account = _make_account()
    app_model = SimpleNamespace(
        id=TEST_APP_ID,
        tenant_id=account.current_tenant_id,
        mode=AppMode.WORKFLOW.value,
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


def test_get_rerun_node_overrideable_variables_success(client, workflow_context, monkeypatch):
    response_payload = {
        "source_workflow_run_id": TEST_RUN_ID,
        "target_node_id": "node_target",
        "groups": [
            {"group": "ancestor_node_outputs", "variables": []},
            {"group": "start_node_variables", "variables": []},
            {"group": "environment_variables", "variables": []},
        ],
    }

    service = MagicMock()
    service.get_overrideable_variables.return_value = response_payload
    monkeypatch.setattr(workflow_run_module, "WorkflowRunRerunService", lambda: service)

    response = client.get(f"/console/api/apps/{TEST_APP_ID}/workflow-runs/{TEST_RUN_ID}/rerun/nodes/node_target")

    assert response.status_code == 200
    assert response.get_json() == response_payload
    service.get_overrideable_variables.assert_called_once_with(
        app_model=workflow_context,
        source_run_id=TEST_RUN_ID,
        target_node_id="node_target",
    )


def test_get_rerun_node_overrideable_variables_handles_service_error(client, workflow_context, monkeypatch):
    service = MagicMock()
    service.get_overrideable_variables.side_effect = WorkflowRunRerunServiceError(
        code="override_out_of_scope",
        status=422,
        message="Override selector is out of rerun scope.",
    )
    monkeypatch.setattr(workflow_run_module, "WorkflowRunRerunService", lambda: service)

    response = client.get(f"/console/api/apps/{TEST_APP_ID}/workflow-runs/{TEST_RUN_ID}/rerun/nodes/node_target")

    assert response.status_code == 422
    assert response.get_json() == {
        "code": "override_out_of_scope",
        "message": "Override selector is out of rerun scope.",
        "status": 422,
    }
