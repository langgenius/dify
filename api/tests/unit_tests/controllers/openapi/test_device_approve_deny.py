"""Account-branch device-flow approve/deny under /openapi/v1."""

import builtins
import uuid
from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import Mock, call

import pytest
from flask import Flask
from flask.views import MethodView

from controllers.openapi import bp as openapi_bp
from controllers.openapi import oauth_device as oauth_device_module
from controllers.openapi.oauth_device import DeviceApproveApi, DeviceDenyApi
from models import Account
from models.account import AccountStatus
from services.oauth_device_flow import DeviceFlowStatus
from services.workspace_member_query_service import WorkspaceMemberRole
from services.workspace_query_service import WorkspaceWithRoles

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def openapi_app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(openapi_bp)
    return app


def _rule(app: Flask, path: str):
    return next(r for r in app.url_map.iter_rules() if r.rule == path)


def test_approve_route_registered(openapi_app: Flask):
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/openapi/v1/oauth/device/approve" in rules


def test_deny_route_registered(openapi_app: Flask):
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/openapi/v1/oauth/device/deny" in rules


def test_approve_dispatches_to_class(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/oauth/device/approve")
    assert openapi_app.view_functions[rule.endpoint].view_class is DeviceApproveApi


def test_deny_dispatches_to_class(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/oauth/device/deny")
    assert openapi_app.view_functions[rule.endpoint].view_class is DeviceDenyApi


def test_approve_and_deny_methods(openapi_app: Flask):
    approve = _rule(openapi_app, "/openapi/v1/oauth/device/approve")
    deny = _rule(openapi_app, "/openapi/v1/oauth/device/deny")
    assert "POST" in approve.methods
    assert "POST" in deny.methods


def test_approve_closes_admission_session_before_resolving_roles(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
):
    tracker = Mock()
    session = object()
    tracker.session.return_value = session

    account = Account(name="Ada", email="ada@example.com", status=AccountStatus.ACTIVE)
    account.id = "account-1"
    tracker.roles.return_value = (
        WorkspaceWithRoles(
            id="workspace-1",
            name="Research",
            status="normal",
            created_at=datetime(2026, 1, 1),
            current=True,
            roles=(
                WorkspaceMemberRole(id="workspace.admin", name="Admin"),
                WorkspaceMemberRole(id="workspace.reviewer", name="Reviewer"),
            ),
        ),
    )
    workspace_queries = SimpleNamespace(list_for_account_with_roles=tracker.roles)
    state = SimpleNamespace(
        status=DeviceFlowStatus.PENDING,
        client_id="difyctl",
        device_label="terminal",
    )
    store = SimpleNamespace(
        load_by_user_code=Mock(return_value=("device-code", state)),
        approve=Mock(),
    )
    mint = SimpleNamespace(
        token="dfoa_token",
        token_id=uuid.uuid4(),
        expires_at=datetime(2026, 2, 1, tzinfo=UTC),
    )

    monkeypatch.setattr(oauth_device_module, "db", SimpleNamespace(session=tracker.session))
    monkeypatch.setattr(
        oauth_device_module,
        "redis_client",
        SimpleNamespace(set=Mock(return_value=True), delete=Mock()),
    )
    monkeypatch.setattr(oauth_device_module, "DeviceFlowRedis", Mock(return_value=store))
    monkeypatch.setattr(
        oauth_device_module,
        "application_services",
        lambda: SimpleNamespace(workspace_queries=workspace_queries),
    )
    monkeypatch.setattr(oauth_device_module, "validate_mint_policy", Mock())
    monkeypatch.setattr(oauth_device_module, "oauth_ttl_days", Mock(return_value=30))
    monkeypatch.setattr(oauth_device_module, "mint_oauth_token", Mock(return_value=mint))
    monkeypatch.setattr(oauth_device_module, "_emit_approve_audit", Mock())

    api = DeviceApproveApi()
    with app.test_request_context(
        "/openapi/v1/oauth/device/approve",
        method="POST",
        json={"user_code": "ABCD-EFGH"},
    ):
        body, status = unwrap(api.post)(api, tenant="workspace-1", account=account)

    assert (body, status) == ({"status": "approved"}, 200)
    assert tracker.mock_calls[:3] == [call.session.remove(), call.roles("account-1"), call.session()]
    assert oauth_device_module.mint_oauth_token.call_args.kwargs["session"] is session
    poll_payload = store.approve.call_args.kwargs["poll_payload"]
    assert poll_payload["default_workspace_id"] == "workspace-1"
    assert poll_payload["workspaces"] == [
        {
            "id": "workspace-1",
            "name": "Research",
            "roles": [
                {"id": "workspace.admin", "name": "Admin"},
                {"id": "workspace.reviewer", "name": "Reviewer"},
            ],
        }
    ]
    assert "role" not in poll_payload["workspaces"][0]
