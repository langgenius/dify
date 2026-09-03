"""User-scoped identity + session endpoints under /openapi/v1/account."""

import builtins
import uuid
from dataclasses import dataclass

import pytest
from flask import Flask
from flask.views import MethodView
from werkzeug.exceptions import UnprocessableEntity

from constants.oauth_bearer import Scope, TokenType
from controllers.openapi import bp as openapi_bp
from controllers.openapi.account import (
    AccountApi,
    AccountSessionByIdApi,
    AccountSessionsApi,
    AccountSessionsSelfApi,
)
from controllers.openapi.auth.data import AuthData
from services.oauth_device_contracts import OAuthDeviceSession, OAuthDeviceSessionPage

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


def test_account_route_registered(openapi_app: Flask):
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/openapi/v1/account" in rules


def test_account_dispatches_to_class(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/account")
    assert openapi_app.view_functions[rule.endpoint].view_class is AccountApi


def test_account_sessions_self_route_registered(openapi_app: Flask):
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/openapi/v1/account/sessions/self" in rules


def test_sessions_self_dispatches_to_class(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/account/sessions/self")
    assert openapi_app.view_functions[rule.endpoint].view_class is AccountSessionsSelfApi


def test_account_methods(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/account")
    assert "GET" in rule.methods


def test_sessions_self_methods(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/account/sessions/self")
    assert "DELETE" in rule.methods


def test_sessions_list_route_registered(openapi_app: Flask):
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/openapi/v1/account/sessions" in rules


def test_sessions_list_dispatches_to_sessions_api(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/account/sessions")
    assert openapi_app.view_functions[rule.endpoint].view_class is AccountSessionsApi
    assert "GET" in rule.methods


def test_session_by_id_route_registered(openapi_app: Flask):
    rules = {r.rule for r in openapi_app.url_map.iter_rules()}
    assert "/openapi/v1/account/sessions/<string:session_id>" in rules


def test_session_by_id_dispatches_to_correct_class(openapi_app: Flask):
    rule = _rule(openapi_app, "/openapi/v1/account/sessions/<string:session_id>")
    assert openapi_app.view_functions[rule.endpoint].view_class is AccountSessionByIdApi
    assert "DELETE" in rule.methods


# --- GET /account/sessions query validation (the handler routes ?page/?limit through
# SessionListQuery so the server enforces the bounds the contract advertises).


def _session_auth_data() -> AuthData:
    return AuthData(
        token_type=TokenType.OAUTH_ACCOUNT,
        account_id=uuid.uuid4(),
        token_hash="test",
        token_id=uuid.uuid4(),
        scopes=frozenset({Scope.FULL}),
        required_scope=Scope.FULL,
        allowed_roles=None,
    )


@dataclass(frozen=True, slots=True)
class _OAuthDeviceService:
    rows: tuple[OAuthDeviceSession, ...]

    def list_account_sessions(self, *, account_id: str, page: int, limit: int) -> OAuthDeviceSessionPage:
        _ = account_id
        return OAuthDeviceSessionPage(page=page, limit=limit, total=len(self.rows), items=self.rows)


@dataclass(frozen=True, slots=True)
class _ApplicationServices:
    oauth_device: _OAuthDeviceService


def _stub_session_deps(monkeypatch: pytest.MonkeyPatch, rows: tuple[OAuthDeviceSession, ...]) -> None:
    from controllers.openapi import account

    services = _ApplicationServices(oauth_device=_OAuthDeviceService(rows=rows))
    monkeypatch.setattr(account, "application_services", lambda: services)


def test_sessions_list_valid_query_parses_page_and_limit(app: Flask, monkeypatch: pytest.MonkeyPatch):
    """A valid ?page&limit round-trips through SessionListQuery into the response envelope."""
    api = AccountSessionsApi()
    _stub_session_deps(monkeypatch, ())
    with app.test_request_context("/openapi/v1/account/sessions?page=2&limit=5"):
        body, status = api.get.__wrapped__(api, auth_data=_session_auth_data())
    assert status == 200
    assert body["page"] == 2
    assert body["limit"] == 5
    assert body["total"] == 0
    assert body["data"] == []


def test_sessions_list_defaults_when_query_omitted(app: Flask, monkeypatch: pytest.MonkeyPatch):
    """No query → the model's defaults (page=1, limit=100) drive the envelope."""
    api = AccountSessionsApi()
    _stub_session_deps(monkeypatch, ())
    with app.test_request_context("/openapi/v1/account/sessions"):
        body, status = api.get.__wrapped__(api, auth_data=_session_auth_data())
    assert status == 200
    assert body["page"] == 1
    assert body["limit"] == 100


@pytest.mark.parametrize(
    "query",
    [
        "page=0",  # below ge=1 (previously coerced to a silent empty slice)
        "page=-3",
        "limit=0",  # below ge=1
        "limit=999",  # above le=MAX_PAGE_LIMIT
        "page=abc",  # not an integer (previously a 500)
        "foo=bar",  # extra='forbid'
    ],
)
def test_sessions_list_rejects_out_of_bounds_query(app: Flask, monkeypatch: pytest.MonkeyPatch, query):
    """Out-of-range / unknown query params raise 422 instead of being silently coerced."""
    api = AccountSessionsApi()
    _stub_session_deps(monkeypatch, ())
    with app.test_request_context(f"/openapi/v1/account/sessions?{query}"):
        with pytest.raises(UnprocessableEntity):
            api.get.__wrapped__(api, auth_data=_session_auth_data())
