"""User-scoped identity + session endpoints under /openapi/v1/account."""

import builtins
import sys
from types import SimpleNamespace

import pytest
from flask import Flask
from flask.views import MethodView
from pydantic import ValidationError

from controllers.openapi import bp as openapi_bp
from controllers.openapi._models import SessionListQuery
from controllers.openapi.account import (
    AccountApi,
    AccountSessionByIdApi,
    AccountSessionsApi,
    AccountSessionsSelfApi,
)
from controllers.openapi.auth.requirements import CheckSessionOwnership, TokenScope

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


def test_revoke_by_id_declares_session_ownership():
    """The route wiring, not the requirement's own logic: `CheckSessionOwnership`
    is what stops a caller revoking a session id belonging to another subject, and
    it is only reachable if this route declares it. Nothing else pins that — the
    allow/deny matrix addresses the caller's own session, so removing the
    declaration changes no row there.
    """
    requirements = AccountSessionByIdApi.delete.__spec__.requirements
    assert any(isinstance(requirement, CheckSessionOwnership) for requirement in requirements)


def test_session_ownership_runs_after_token_scope():
    """`CheckSessionOwnership` takes the default rank, so it is tied with
    `TokenScope` — declaration order is what keeps a caller failing scope alone
    from reaching the ownership check first.
    """
    requirements = AccountSessionByIdApi.delete.__spec__.requirements
    token_scope_index = next(i for i, r in enumerate(requirements) if isinstance(r, TokenScope))
    ownership_index = next(i for i, r in enumerate(requirements) if isinstance(r, CheckSessionOwnership))
    assert token_scope_index < ownership_index


def test_the_other_session_routes_do_not_declare_it():
    """`revoke_self` and the listing scope themselves by subject, so a per-session
    ownership check would have nothing to name.
    """
    for view in (AccountSessionsSelfApi.delete, AccountSessionsApi.get):
        assert not any(isinstance(requirement, CheckSessionOwnership) for requirement in view.__spec__.requirements)


def test_subject_match_for_account_filters_by_account_id():
    """Account subject scopes queries via account_id."""
    import uuid as _uuid

    from libs.oauth_bearer import AuthContext, SubjectType, TokenType
    from services.oauth_device_flow import subject_match_clauses

    aid = _uuid.uuid4()
    ctx = AuthContext(
        subject_type=SubjectType.ACCOUNT,
        subject_email="user@example.com",
        subject_issuer="dify:account",
        account_id=aid,
        client_id="difyctl",
        scopes=frozenset({"full"}),
        token_id=_uuid.uuid4(),
        token_type=TokenType.OAUTH_ACCOUNT,
        expires_at=None,
    )
    clauses = subject_match_clauses(ctx)
    # One predicate, on account_id
    assert len(clauses) == 1
    assert "account_id" in str(clauses[0])


def test_subject_match_for_external_sso_filters_by_email_and_issuer():
    """External SSO subject scopes via (subject_email, subject_issuer)
    AND account_id IS NULL — so a same-email account row from a
    federated tenant cannot be revoked through an SSO bearer.
    """
    import uuid as _uuid

    from libs.oauth_bearer import AuthContext, SubjectType, TokenType
    from services.oauth_device_flow import subject_match_clauses

    ctx = AuthContext(
        subject_type=SubjectType.EXTERNAL_SSO,
        subject_email="sso@partner.com",
        subject_issuer="https://idp.partner.com",
        account_id=None,
        client_id="difyctl",
        scopes=frozenset({"apps:run"}),
        token_id=_uuid.uuid4(),
        token_type=TokenType.OAUTH_EXTERNAL_SSO,
        expires_at=None,
    )
    clauses = subject_match_clauses(ctx)
    assert len(clauses) == 3
    rendered = " ".join(str(c) for c in clauses)
    assert "subject_email" in rendered
    assert "subject_issuer" in rendered
    assert "account_id IS NULL" in rendered


_ACCOUNT_MOD = "controllers.openapi.account"


def _stub_session_deps(monkeypatch: pytest.MonkeyPatch, rows):
    mod = sys.modules[_ACCOUNT_MOD]
    monkeypatch.setattr(mod, "get_auth_ctx", lambda: SimpleNamespace())
    monkeypatch.setattr(mod, "list_active_sessions", lambda *args, **kwargs: rows)


def test_sessions_list_valid_query_parses_page_and_limit(monkeypatch: pytest.MonkeyPatch):
    """A valid page/limit round-trips through SessionListQuery into the response envelope."""
    api = AccountSessionsApi()
    _stub_session_deps(monkeypatch, [])
    ctx = SimpleNamespace(session=object())
    result = api.get.__handler__(api, ctx, query=SessionListQuery(page=2, limit=5))
    assert result.page == 2
    assert result.limit == 5
    assert result.total == 0
    assert result.data == []


def test_sessions_list_defaults_when_query_omitted(monkeypatch: pytest.MonkeyPatch):
    """No query → the model's defaults (page=1, limit=100) drive the envelope."""
    api = AccountSessionsApi()
    _stub_session_deps(monkeypatch, [])
    ctx = SimpleNamespace(session=object())
    result = api.get.__handler__(api, ctx, query=SessionListQuery())
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
    """`__handler__` receives an already-validated query, so the bounds this pinned via
    the handler now live at the model — same rejection, moved to where it happens.
    """
    with pytest.raises(ValidationError):
        SessionListQuery.model_validate(params)
