import uuid
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from flask import Flask
from werkzeug.exceptions import Unauthorized

from controllers.openapi.auth.context import Context
from controllers.openapi.auth.steps import BearerCheck
from libs.oauth_bearer import (
    AuthContext,
    InvalidBearerError,
    Scope,
    SubjectType,
    reset_auth_ctx,
    try_get_auth_ctx,
)


def _ctx(bearer_token: str | None) -> Context:
    return Context(required_scope="apps:run", bearer_token=bearer_token)


def test_bearer_check_rejects_missing_header():
    app = Flask(__name__)
    with app.test_request_context(), pytest.raises(Unauthorized):
        BearerCheck()(_ctx(None))


@patch("controllers.openapi.auth.steps.get_authenticator")
def test_bearer_check_rejects_unknown_prefix(get_auth):
    get_auth.return_value.authenticate.side_effect = InvalidBearerError("unknown token prefix")
    app = Flask(__name__)
    with app.test_request_context(), pytest.raises(Unauthorized):
        BearerCheck()(_ctx("xxx_abc"))


@patch("controllers.openapi.auth.steps.get_authenticator")
def test_bearer_check_populates_context_and_publishes_auth_ctx(get_auth):
    tok_id = uuid.uuid4()
    authn = AuthContext(
        subject_type=SubjectType.ACCOUNT,
        subject_email="a@x.com",
        subject_issuer=None,
        account_id=None,
        client_id="difyctl",
        scopes=frozenset({Scope.FULL}),
        token_id=tok_id,
        source="oauth-account",
        expires_at=datetime.now(UTC),
        token_hash="hash-1",
        verified_tenants={},
    )
    get_auth.return_value.authenticate.return_value = authn

    app = Flask(__name__)
    ctx = _ctx("dfoa_abc")
    with app.test_request_context():
        BearerCheck()(ctx)
        try:
            assert ctx.subject_type == SubjectType.ACCOUNT
            assert ctx.subject_email == "a@x.com"
            assert ctx.scopes == frozenset({Scope.FULL})
            assert ctx.source == "oauth-account"
            assert ctx.token_id == tok_id
            assert ctx.token_hash == "hash-1"
            # BearerCheck must also publish the same identity on the
            # openapi auth ContextVar so the surface gate + downstream
            # handlers don't see two different identity sources between
            # the decorator + pipeline paths. The reset token is parked
            # on `ctx.auth_ctx_reset_token` for `Pipeline.guard` to
            # consume in its `finally`.
            published = try_get_auth_ctx()
            assert published is authn
            assert published.client_id == "difyctl"
            assert ctx.auth_ctx_reset_token is not None
        finally:
            # In production `Pipeline.guard` resets the ContextVar; in
            # this isolated step-level test we reset it ourselves so the
            # value doesn't leak into the next test on the same worker.
            assert ctx.auth_ctx_reset_token is not None
            reset_auth_ctx(ctx.auth_ctx_reset_token)
