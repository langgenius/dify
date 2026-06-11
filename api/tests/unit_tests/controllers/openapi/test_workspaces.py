"""Phase E step 17: workspace reads at /openapi/v1/workspaces. Bearer-authed
list + member-gated detail. No legacy /v1/ equivalent — the cookie-authed
/console/api/workspaces is a separate consumer that stays in console.
"""

import builtins
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock

import pytest
from flask import Flask
from flask.views import MethodView

from controllers.openapi import bp as openapi_bp
from controllers.openapi.auth.data import AuthData
from controllers.openapi.workspaces import WorkspaceByIdApi, WorkspacesApi
from libs.oauth_bearer import Scope, TokenType

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


def _auth_data(account_id: uuid.UUID) -> AuthData:
    return AuthData(
        token_type=TokenType.OAUTH_ACCOUNT,
        account_id=account_id,
        token_hash="testhash",
        scopes=frozenset({Scope.FULL}),
    )


def _call_with_session(method, resource, session: MagicMock, /, *args, **kwargs):
    """Bypass auth and `with_session`, while keeping contract wrappers."""
    return method.__wrapped__.__wrapped__(resource, session, *args, **kwargs)


def _tenant(tenant_id: str = "ws-1") -> SimpleNamespace:
    return SimpleNamespace(
        id=tenant_id,
        name="WS",
        status="normal",
        created_at=datetime(2026, 5, 18, tzinfo=UTC),
    )


def test_workspaces_list_route_registered(openapi_app: Flask):
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/openapi/v1/workspaces" in rules


def test_workspaces_list_dispatches_to_workspaces_api(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/workspaces")
    assert openapi_app.view_functions[rule.endpoint].view_class is WorkspacesApi
    assert "GET" in rule.methods


def test_workspace_by_id_route_registered(openapi_app: Flask):
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/openapi/v1/workspaces/<string:workspace_id>" in rules


def test_workspace_by_id_dispatches_to_correct_class(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/workspaces/<string:workspace_id>")
    assert openapi_app.view_functions[rule.endpoint].view_class is WorkspaceByIdApi
    assert "GET" in rule.methods


def test_console_legacy_workspaces_route_not_remounted_on_openapi(openapi_app: Flask):
    """Phase E only adds the bearer-authed mounts on /openapi/v1/.
    The cookie-authed /console/api/workspaces stays where it is.
    """
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/console/api/workspaces" not in rules


def test_workspaces_list_uses_injected_session(monkeypatch):
    acct_id = uuid.uuid4()
    api = WorkspacesApi()
    session = MagicMock()
    membership = SimpleNamespace(role="owner", current=True)
    get_workspaces = Mock(return_value=[(_tenant("ws-1"), membership)])

    monkeypatch.setattr(
        "controllers.openapi.workspaces.TenantService",
        SimpleNamespace(get_workspaces_for_account=get_workspaces),
    )

    body, status = _call_with_session(api.get, api, session, auth_data=_auth_data(acct_id))

    assert status == 200
    assert body["workspaces"][0]["id"] == "ws-1"
    get_workspaces.assert_called_once_with(session, str(acct_id))


def test_workspace_detail_uses_injected_session(monkeypatch):
    acct_id = uuid.uuid4()
    ws_id = str(uuid.uuid4())
    api = WorkspaceByIdApi()
    session = MagicMock()
    membership = SimpleNamespace(role="admin", current=False)
    find_workspace = Mock(return_value=(_tenant(ws_id), membership))

    monkeypatch.setattr(
        "controllers.openapi.workspaces.TenantService",
        SimpleNamespace(find_workspace_for_account=find_workspace),
    )

    body, status = _call_with_session(api.get, api, session, workspace_id=ws_id, auth_data=_auth_data(acct_id))

    assert status == 200
    assert body["id"] == ws_id
    find_workspace.assert_called_once_with(session, str(acct_id), ws_id)
