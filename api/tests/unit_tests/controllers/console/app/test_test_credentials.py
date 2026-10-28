from dataclasses import replace
from types import SimpleNamespace

import pytest
from flask import Flask
from werkzeug.local import LocalProxy

from controllers.console import wraps
from controllers.console.app import test_credentials as controller
from enums import DeploymentEdition
from libs import login
from models.account import Account, AccountStatus, Tenant, TenantAccountRole
from services.workflow_test_credentials import TestCredentialPreflight as CredentialPreflight
from services.workflow_test_credentials import TestCredentialUnavailableError as Unavailable
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.controllers.error_body import raised_error
from tests.helpers.workflow_test_credentials import SCOPE, BuilderCredentialHarness, tool_node


@pytest.fixture
def harness(monkeypatch: pytest.MonkeyPatch) -> BuilderCredentialHarness:
    harness = BuilderCredentialHarness({"nodes": [tool_node("a")]})
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
    return harness


def test_console_preflight_reads_saved_selection_and_returns_no_secret(
    app: Flask, harness: BuilderCredentialHarness
) -> None:
    with app.test_request_context("/preflight", method="POST", json={"draft_hash": "saved-hash", "node_id": "a"}):
        result = controller.TestCredentialPreflightApi().post(app_id=SCOPE.app_id)
    assert harness.calls == ["credential"]
    assert result["ready"] is True
    assert result["draft_hash"] == "saved-hash"
    assert result["credentials"][0]["credential_id"] == "credential"
    assert "secret" not in str(result)


def test_preflight_reports_missing_selection_without_creating_run(
    app: Flask, harness: BuilderCredentialHarness
) -> None:
    harness.failure = Unavailable("disconnected")
    with app.test_request_context("/preflight", method="POST", json={"draft_hash": "saved-hash"}):
        result = controller.TestCredentialPreflightApi().post(app_id=SCOPE.app_id)
    assert result["ready"] is False
    assert result["credentials"][0]["credential_id"] is None


def test_preflight_maps_stale_draft_to_conflict(app: Flask, harness: BuilderCredentialHarness) -> None:
    harness.draft = replace(harness.draft, hash="new-hash")
    with app.test_request_context("/preflight", method="POST", json={"draft_hash": "saved-hash"}):
        body, status = raised_error(lambda: controller.TestCredentialPreflightApi().post(app_id=SCOPE.app_id))
    assert status == 409
    assert body["code"] == "test_credential_draft_changed"
    assert not harness.calls


def test_run_error_includes_actionable_readiness(app: Flask, harness: BuilderCredentialHarness) -> None:
    harness.failure = Unavailable("incompatible")

    @controller.test_credential_errors
    def run() -> CredentialPreflight:
        return harness.service.require_ready(SCOPE, draft_hash="saved-hash", node_id=None)

    with app.test_request_context("/run", method="POST"):
        body, status = raised_error(run)
    assert status == 400
    assert body["code"] == "test_credentials_not_ready"
    assert (
        controller.TestCredentialPreflightResponse.model_validate(body["details"]).credentials[0].status
        == "incompatible"
    )
