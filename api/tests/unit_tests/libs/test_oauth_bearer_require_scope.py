"""require_scope is a route-level gate run after validate_bearer.
Tests use a fake auth_ctx attached directly to flask.g — no
authenticator wiring needed.
"""
from __future__ import annotations

import uuid

import pytest
from flask import Flask, g
from werkzeug.exceptions import Forbidden

from libs.oauth_bearer import (
    SCOPE_FULL,
    AuthContext,
    SubjectType,
    require_scope,
)


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


def _ctx(scopes: frozenset[str]) -> AuthContext:
    return AuthContext(
        subject_type=SubjectType.ACCOUNT,
        subject_email="user@example.com",
        subject_issuer="dify:account",
        account_id=uuid.uuid4(),
        scopes=scopes,
        token_id=uuid.uuid4(),
        source="oauth_account",
        expires_at=None,
    )


def test_require_scope_allows_when_scope_present(app: Flask):
    @require_scope("apps:read")
    def view():
        return "ok"

    with app.test_request_context():
        g.auth_ctx = _ctx(frozenset({"apps:read"}))
        assert view() == "ok"


def test_require_scope_rejects_when_scope_missing(app: Flask):
    @require_scope("apps:write")
    def view():
        return "ok"

    with app.test_request_context():
        g.auth_ctx = _ctx(frozenset({"apps:read"}))
        with pytest.raises(Forbidden) as exc:
            view()
    assert "insufficient_scope: apps:write" in str(exc.value.description)


def test_require_scope_full_passes_any_check(app: Flask):
    @require_scope("apps:write")
    def view():
        return "ok"

    with app.test_request_context():
        g.auth_ctx = _ctx(frozenset({SCOPE_FULL}))
        assert view() == "ok"


def test_require_scope_without_validate_bearer_raises_runtime_error(app: Flask):
    @require_scope("apps:read")
    def view():
        return "ok"

    with app.test_request_context():
        # No g.auth_ctx — validate_bearer was forgotten
        with pytest.raises(RuntimeError, match="stack @validate_bearer above @require_scope"):
            view()
