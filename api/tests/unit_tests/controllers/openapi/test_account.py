"""Phase C steps 9–10: identity + self-revoke moved to /openapi/v1/account.
Legacy /v1/me + /v1/oauth/authorizations/self stay mounted via
re-registration in service_api/oauth.py.
"""
import builtins

import pytest
from flask import Flask
from flask.views import MethodView

from controllers.openapi import bp as openapi_bp
from controllers.openapi.account import (
    AccountApi,
    AccountSessionByIdApi,
    AccountSessionsApi,
    AccountSessionsSelfApi,
)
from controllers.service_api import bp as service_api_bp

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def dual_app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(service_api_bp)
    app.register_blueprint(openapi_bp)
    return app


def _rule(app: Flask, path: str):
    return next(r for r in app.url_map.iter_rules() if r.rule == path)


def test_account_route_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/openapi/v1/account" in rules


def test_legacy_me_route_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/v1/me" in rules


def test_account_and_me_dispatch_to_same_class(dual_app: Flask):
    new = _rule(dual_app, "/openapi/v1/account")
    legacy = _rule(dual_app, "/v1/me")
    assert dual_app.view_functions[new.endpoint].view_class is AccountApi
    assert dual_app.view_functions[legacy.endpoint].view_class is AccountApi


def test_account_sessions_self_route_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/openapi/v1/account/sessions/self" in rules


def test_legacy_oauth_authorizations_self_route_registered(dual_app: Flask):
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/v1/oauth/authorizations/self" in rules


def test_sessions_self_paths_dispatch_to_same_class(dual_app: Flask):
    new = _rule(dual_app, "/openapi/v1/account/sessions/self")
    legacy = _rule(dual_app, "/v1/oauth/authorizations/self")
    assert dual_app.view_functions[new.endpoint].view_class is AccountSessionsSelfApi
    assert dual_app.view_functions[legacy.endpoint].view_class is AccountSessionsSelfApi


def test_account_methods(dual_app: Flask):
    rule = _rule(dual_app, "/openapi/v1/account")
    assert "GET" in rule.methods


def test_sessions_self_methods(dual_app: Flask):
    rule = _rule(dual_app, "/openapi/v1/account/sessions/self")
    assert "DELETE" in rule.methods


def test_sessions_list_route_registered(dual_app: Flask):
    """GET /openapi/v1/account/sessions is new — no /v1/ equivalent."""
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/openapi/v1/account/sessions" in rules


def test_sessions_list_dispatches_to_sessions_api(dual_app: Flask):
    rule = _rule(dual_app, "/openapi/v1/account/sessions")
    assert dual_app.view_functions[rule.endpoint].view_class is AccountSessionsApi
    assert "GET" in rule.methods


def test_session_by_id_route_registered(dual_app: Flask):
    """DELETE /openapi/v1/account/sessions/<id> is new — no /v1/ equivalent."""
    rules = {r.rule for r in dual_app.url_map.iter_rules()}
    assert "/openapi/v1/account/sessions/<string:session_id>" in rules


def test_session_by_id_dispatches_to_correct_class(dual_app: Flask):
    rule = _rule(dual_app, "/openapi/v1/account/sessions/<string:session_id>")
    assert dual_app.view_functions[rule.endpoint].view_class is AccountSessionByIdApi
    assert "DELETE" in rule.methods


def test_subject_match_for_account_filters_by_account_id():
    """Account subject scopes queries via account_id."""
    import uuid as _uuid

    from controllers.openapi.account import _subject_match
    from libs.oauth_bearer import AuthContext, SubjectType

    aid = _uuid.uuid4()
    ctx = AuthContext(
        subject_type=SubjectType.ACCOUNT,
        subject_email="user@example.com",
        subject_issuer="dify:account",
        account_id=aid,
        scopes=frozenset({"full"}),
        token_id=_uuid.uuid4(),
        source="oauth_account",
        expires_at=None,
    )
    clauses = _subject_match(ctx)
    # One predicate, on account_id
    assert len(clauses) == 1
    assert "account_id" in str(clauses[0])


def test_subject_match_for_external_sso_filters_by_email_and_issuer():
    """External SSO subject scopes via (subject_email, subject_issuer)
    AND account_id IS NULL — so a same-email account row from a
    federated tenant cannot be revoked through an SSO bearer.
    """
    import uuid as _uuid

    from controllers.openapi.account import _subject_match
    from libs.oauth_bearer import AuthContext, SubjectType

    ctx = AuthContext(
        subject_type=SubjectType.EXTERNAL_SSO,
        subject_email="sso@partner.com",
        subject_issuer="https://idp.partner.com",
        account_id=None,
        scopes=frozenset({"apps:run"}),
        token_id=_uuid.uuid4(),
        source="oauth_external_sso",
        expires_at=None,
    )
    clauses = _subject_match(ctx)
    assert len(clauses) == 3
    rendered = " ".join(str(c) for c in clauses)
    assert "subject_email" in rendered
    assert "subject_issuer" in rendered
    assert "account_id IS NULL" in rendered
