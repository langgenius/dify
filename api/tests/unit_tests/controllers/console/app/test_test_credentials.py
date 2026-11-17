import pytest
from flask import Flask

from controllers.console.app import test_credentials as controller
from controllers.console.app.workflow import (
    AdvancedChatWorkflowRunPayload,
    DraftWorkflowNodeRunPayload,
    DraftWorkflowRunPayload,
    IterationNodeRunPayload,
    LoopNodeRunPayload,
)
from tests.helpers.unit.controllers.error_body import raised_error
from tests.helpers.workflow_test_credentials import SCOPE, BuilderCredentialHarness, tool_node


def test_run_error_includes_actionable_readiness(app: Flask) -> None:
    harness = BuilderCredentialHarness({"nodes": [tool_node("a", None)]})

    @controller.test_credential_errors
    def run() -> None:
        harness.service.require_ready(SCOPE, graph=harness.graph, node_id=None)

    with app.test_request_context("/run", method="POST"):
        body, status = raised_error(run)
    assert status == 400
    assert body["code"] == "test_credentials_not_ready"
    assert body["details"] == {
        "ready": False,
        "credentials": [
            {
                "node_id": "a",
                "node_ids": ["a"],
                "credential_id": None,
                "status": "disconnected",
                "check": None,
            }
        ],
    }


def test_run_payloads_keep_the_existing_inputs_without_a_draft_hash() -> None:
    for model in (
        AdvancedChatWorkflowRunPayload,
        DraftWorkflowNodeRunPayload,
        DraftWorkflowRunPayload,
        IterationNodeRunPayload,
        LoopNodeRunPayload,
    ):
        payload = model.model_validate({"inputs": {}})
        assert "draft_hash" not in payload.model_dump()
        assert "draft_hash" not in model.model_fields


def test_full_preflight_requires_no_body_and_reports_unready_nodes(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    from types import SimpleNamespace

    from werkzeug.local import LocalProxy

    from controllers.console import wraps
    from enums import DeploymentEdition
    from libs import login
    from models.account import Account, AccountStatus, Tenant, TenantAccountRole
    from tests.helpers.unit.config_override import apply_config_overrides

    harness = BuilderCredentialHarness({"nodes": [tool_node("a"), tool_node("b", None)]})
    account = Account(name="Builder", email="builder@example.com", status=AccountStatus.ACTIVE)
    account.id = SCOPE.account_id
    account.role = TenantAccountRole.EDITOR
    account._current_tenant = Tenant(name="Workspace")
    account._current_tenant.id = SCOPE.tenant_id
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        LOGIN_DISABLED=True,
        INIT_PASSWORD="",
        RBAC_ENABLED=False,
    )
    monkeypatch.setattr(login, "current_user", LocalProxy(lambda: account))
    monkeypatch.setattr(login, "current_account_with_tenant", lambda: (account, SCOPE.tenant_id))
    monkeypatch.setattr(login, "check_csrf_token", lambda *_: None)
    monkeypatch.setattr(wraps, "current_account_with_tenant", lambda: (account, SCOPE.tenant_id))
    monkeypatch.setattr(controller, "current_account_with_tenant", lambda: (account, SCOPE.tenant_id))
    monkeypatch.setattr(
        controller, "application_services", lambda: SimpleNamespace(workflow_test_credentials=harness.service)
    )
    with app.test_request_context("/preflight", method="POST"):
        result = controller.TestCredentialPreflightApi().post(app_id=SCOPE.app_id)
    assert result["ready"] is False
    assert len(result["credentials"]) == 2
    assert "draft_hash" not in result
    assert "secret" not in str(result)
