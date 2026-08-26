"""User-scoped identity + session endpoints under /openapi/v1/account."""

import builtins
import sys
from types import SimpleNamespace

import pytest
from flask import Flask
from flask.views import MethodView
from werkzeug.exceptions import NotFound, UnprocessableEntity

from controllers.openapi import bp as openapi_bp
from controllers.openapi.account import (
    AccountApi,
    AccountSessionByIdApi,
    AccountSessionsApi,
    AccountSessionsSelfApi,
)
from machinery.context import RequestContext
from services.entities.account_access_entities import AccountSessionPage

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


def test_session_by_id_rejects_malformed_uuid(app: Flask) -> None:
    api = AccountSessionByIdApi()
    with app.test_request_context("/openapi/v1/account/sessions/not-a-uuid", method="DELETE"):
        with pytest.raises(NotFound, match="session not found"):
            api.delete.__wrapped__(api, _request_context(), session_id="not-a-uuid")


# --- GET /account/sessions query validation (the handler routes ?page/?limit through
# SessionListQuery so the server enforces the bounds the contract advertises). The application
# service is replaced with a small fake so these exercise only parsing and serialization;
# __wrapped__ skips the complete Admission boundary. ---

_ACCOUNT_MOD = "controllers.openapi.account"


def _request_context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id=None,
        access_token_id="token-1",
    )


class _SessionListService:
    def list_sessions(self, context: RequestContext, *, page: int, limit: int) -> AccountSessionPage:
        return AccountSessionPage(page=page, limit=limit, total=0, items=())


def _stub_account_service(monkeypatch: pytest.MonkeyPatch) -> None:
    mod = sys.modules[_ACCOUNT_MOD]
    services = SimpleNamespace(accounts=SimpleNamespace(access=_SessionListService()))
    monkeypatch.setattr(mod, "application_services", lambda: services)


def test_sessions_list_valid_query_parses_page_and_limit(app: Flask, monkeypatch: pytest.MonkeyPatch):
    """A valid ?page&limit round-trips through SessionListQuery into the response envelope."""
    api = AccountSessionsApi()
    _stub_account_service(monkeypatch)
    with app.test_request_context("/openapi/v1/account/sessions?page=2&limit=5"):
        body, status = api.get.__wrapped__(api, _request_context())
    assert status == 200
    assert body["page"] == 2
    assert body["limit"] == 5
    assert body["total"] == 0
    assert body["data"] == []


def test_sessions_list_defaults_when_query_omitted(app: Flask, monkeypatch: pytest.MonkeyPatch):
    """No query → the model's defaults (page=1, limit=100) drive the envelope."""
    api = AccountSessionsApi()
    _stub_account_service(monkeypatch)
    with app.test_request_context("/openapi/v1/account/sessions"):
        body, status = api.get.__wrapped__(api, _request_context())
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
    _stub_account_service(monkeypatch)
    with app.test_request_context(f"/openapi/v1/account/sessions?{query}"):
        with pytest.raises(UnprocessableEntity):
            api.get.__wrapped__(api, _request_context())
