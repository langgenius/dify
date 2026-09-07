"""User-scoped identity + session endpoints under /openapi/v1/account."""

import builtins
import sys
import uuid
from types import SimpleNamespace

import pytest
from flask import Flask
from flask.views import MethodView
from pydantic import ValidationError
from werkzeug.exceptions import NotFound

from controllers.openapi import bp as openapi_bp
from controllers.openapi._models import SessionListQuery
from controllers.openapi.account import (
    AccountApi,
    AccountSessionByIdApi,
    AccountSessionsApi,
    AccountSessionsSelfApi,
)
from machinery.context import AccountRequestContext
from services.account_errors import AccountSessionNotFoundError
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


def test_revoke_by_id_hides_a_session_the_caller_does_not_own(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """The access service refuses a token id owned by another account; the route
    answers 404, not 403, so session ids cannot be probed across accounts.
    """
    api = AccountSessionByIdApi()
    _stub_account_service(monkeypatch)
    foreign_id = str(uuid.uuid4())
    with app.test_request_context(f"/openapi/v1/account/sessions/{foreign_id}", method="DELETE"):
        with pytest.raises(NotFound, match="session not found"):
            api.delete.__handler__(api, _ctx(), session_id=foreign_id)


def test_session_by_id_rejects_malformed_uuid(app: Flask) -> None:
    api = AccountSessionByIdApi()
    with app.test_request_context("/openapi/v1/account/sessions/not-a-uuid", method="DELETE"):
        with pytest.raises(NotFound, match="session not found"):
            api.delete.__handler__(api, _ctx(), session_id="not-a-uuid")


# --- GET /account/sessions query validation. The application service is replaced
# with a small fake so these exercise only the handler's projection; `__handler__`
# receives an already-validated query, so the bounds are pinned at the model. ---

_ACCOUNT_MOD = "controllers.openapi.account"


def _ctx() -> SimpleNamespace:
    return SimpleNamespace(subject=SimpleNamespace(account_id=uuid.uuid4(), token_id=uuid.uuid4()))


class _SessionListService:
    def list_sessions(self, _context: AccountRequestContext, *, page: int, limit: int) -> AccountSessionPage:
        return AccountSessionPage(page=page, limit=limit, total=0, items=())

    def revoke_session(self, _context: AccountRequestContext, *, token_id: str) -> None:
        raise AccountSessionNotFoundError(token_id)


def _stub_account_service(monkeypatch: pytest.MonkeyPatch) -> None:
    mod = sys.modules[_ACCOUNT_MOD]
    services = SimpleNamespace(accounts=SimpleNamespace(access=_SessionListService()))
    monkeypatch.setattr(mod, "application_services", lambda: services)


def test_sessions_list_valid_query_parses_page_and_limit(app: Flask, monkeypatch: pytest.MonkeyPatch):
    """A valid page/limit round-trips through SessionListQuery into the response envelope."""
    api = AccountSessionsApi()
    _stub_account_service(monkeypatch)
    with app.test_request_context("/openapi/v1/account/sessions?page=2&limit=5"):
        result = api.get.__handler__(api, _ctx(), query=SessionListQuery(page=2, limit=5))
    assert result.page == 2
    assert result.limit == 5
    assert result.total == 0
    assert result.data == []


def test_sessions_list_defaults_when_query_omitted(app: Flask, monkeypatch: pytest.MonkeyPatch):
    """No query → the model's defaults (page=1, limit=100) drive the envelope."""
    api = AccountSessionsApi()
    _stub_account_service(monkeypatch)
    with app.test_request_context("/openapi/v1/account/sessions"):
        result = api.get.__handler__(api, _ctx(), query=SessionListQuery())
    assert result.page == 1
    assert result.limit == 100


@pytest.mark.parametrize(
    "params",
    [
        {"page": "0"},
        {"page": "-3"},
        {"limit": "0"},
        {"limit": "999"},
        {"page": "abc"},
        {"foo": "bar"},
    ],
)
def test_session_list_query_rejects_out_of_bounds(params):
    with pytest.raises(ValidationError):
        SessionListQuery.model_validate(params)
