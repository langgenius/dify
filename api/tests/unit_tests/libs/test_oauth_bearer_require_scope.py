"""require_scope is a route-level gate run after validate_bearer.
Tests use a fake auth_ctx published via the openapi auth ContextVar (no
authenticator wiring needed). The `_publish_auth_ctx` helper guarantees
the ContextVar is reset between tests so worker-thread reuse can't leak
identity into the next test.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from libs.oauth_bearer import (
    AuthContext,
    Scope,
    SubjectType,
    TokenType,
    require_scope,
    reset_auth_ctx,
    set_auth_ctx,
)


@contextmanager
def _publish_auth_ctx(ctx: AuthContext) -> Iterator[None]:
    token = set_auth_ctx(ctx)
    try:
        yield
    finally:
        reset_auth_ctx(token)


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


def _ctx(scopes) -> AuthContext:
    return AuthContext(
        subject_type=SubjectType.ACCOUNT,
        subject_email="user@example.com",
        subject_issuer="dify:account",
        account_id=uuid.uuid4(),
        client_id="difyctl",
        scopes=scopes,
        token_id=uuid.uuid4(),
        token_type=TokenType.OAUTH_ACCOUNT,
        expires_at=None,
        token_hash="h1",
        verified_tenants={},
    )


def test_require_scope_allows_when_scope_present(app: Flask):
    @require_scope("apps:read")
    def view():
        return "ok"

    with app.test_request_context(), _publish_auth_ctx(_ctx(frozenset({"apps:read"}))):
        assert view() == "ok"


def test_require_scope_rejects_when_scope_missing(app: Flask):
    @require_scope("apps:write")
    def view():
        return "ok"

    with app.test_request_context(), _publish_auth_ctx(_ctx(frozenset({"apps:read"}))):
        with pytest.raises(Forbidden) as exc:
            view()
    assert "insufficient_scope: apps:write" in str(exc.value.description)


def test_require_scope_full_passes_any_check(app: Flask):
    @require_scope("apps:write")
    def view():
        return "ok"

    with app.test_request_context(), _publish_auth_ctx(_ctx(frozenset({Scope.FULL}))):
        assert view() == "ok"


def test_require_scope_without_validate_bearer_raises_runtime_error(app: Flask):
    @require_scope("apps:read")
    def view():
        return "ok"

    with app.test_request_context():
        # No auth ContextVar published — validate_bearer was forgotten.
        with pytest.raises(RuntimeError, match="stack @validate_bearer above @require_scope"):
            view()
