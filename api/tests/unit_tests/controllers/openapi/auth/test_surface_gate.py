"""Surface gate tests.

The gate has two attachment forms — decorator (`accept_subjects`) and
pipeline step (`SurfaceCheck`) — and both must:
- 403 on mismatched subject type with a canonical-path hint
- emit `openapi.wrong_surface_denied` once with the right payload
- pass-through on match
- raise RuntimeError (not 403) if g.auth_ctx is missing — that's a
  wiring bug, not a user-driven failure
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask, g
from werkzeug.exceptions import Forbidden

from controllers.openapi.auth.context import Context
from controllers.openapi.auth.steps import SurfaceCheck
from controllers.openapi.auth.surface_gate import _coerce_subject_type, accept_subjects, check_surface
from libs.oauth_bearer import AuthContext, Scope, SubjectType


def _account_ctx() -> AuthContext:
    return AuthContext(
        subject_type=SubjectType.ACCOUNT,
        subject_email="user@example.com",
        subject_issuer="dify:account",
        account_id=uuid.uuid4(),
        client_id="difyctl",
        scopes=frozenset({Scope.FULL}),
        token_id=uuid.uuid4(),
        source="oauth_account",
        expires_at=datetime.now(UTC),
        token_hash="h1",
        verified_tenants={},
    )


def _sso_ctx() -> AuthContext:
    return AuthContext(
        subject_type=SubjectType.EXTERNAL_SSO,
        subject_email="sso@partner.com",
        subject_issuer="https://idp.partner.com",
        account_id=None,
        client_id="difyctl",
        scopes=frozenset({Scope.APPS_RUN, Scope.APPS_READ_PERMITTED_EXTERNAL}),
        token_id=uuid.uuid4(),
        source="oauth_external_sso",
        expires_at=datetime.now(UTC),
        token_hash="h2",
        verified_tenants={},
    )


# ---------------------------------------------------------------------------
# check_surface — shared core
# ---------------------------------------------------------------------------


def test_check_surface_passes_when_subject_in_accepted():
    app = Flask(__name__)
    with app.test_request_context("/openapi/v1/apps"):
        g.auth_ctx = _account_ctx()
        check_surface(frozenset({SubjectType.ACCOUNT}))  # no raise


def test_check_surface_rejects_on_wrong_subject_and_emits_audit():
    app = Flask(__name__)
    with app.test_request_context("/openapi/v1/permitted-external-apps"):
        g.auth_ctx = _account_ctx()
        with patch("controllers.openapi.auth.surface_gate.emit_wrong_surface") as emit:
            with pytest.raises(Forbidden) as exc:
                check_surface(frozenset({SubjectType.EXTERNAL_SSO}))
            assert "wrong_surface" in exc.value.description
            # canonical-path hint should point at the caller's surface,
            # not the surface they were rejected from
            assert "/openapi/v1/apps" in exc.value.description
            emit.assert_called_once()
            kwargs = emit.call_args.kwargs
            assert kwargs["subject_type"] == SubjectType.ACCOUNT.value
            assert kwargs["attempted_path"] == "/openapi/v1/permitted-external-apps"
            assert kwargs["client_id"] == "difyctl"
            assert kwargs["token_id"] is not None


def test_check_surface_rejects_sso_on_account_surface():
    app = Flask(__name__)
    with app.test_request_context("/openapi/v1/apps"):
        g.auth_ctx = _sso_ctx()
        with patch("controllers.openapi.auth.surface_gate.emit_wrong_surface") as emit:
            with pytest.raises(Forbidden):
                check_surface(frozenset({SubjectType.ACCOUNT}))
            kwargs = emit.call_args.kwargs
            assert kwargs["subject_type"] == SubjectType.EXTERNAL_SSO.value


def test_check_surface_runtime_error_when_g_auth_ctx_missing():
    """Missing g.auth_ctx means the bearer layer didn't run — wiring bug,
    not a user-driven failure. Surface as RuntimeError (loud) so a future
    refactor doesn't accidentally let a route skip authentication and
    return a 403 that looks identical to a legitimate wrong-surface deny.
    """
    app = Flask(__name__)
    with app.test_request_context("/openapi/v1/apps"):
        with pytest.raises(RuntimeError):
            check_surface(frozenset({SubjectType.ACCOUNT}))


# ---------------------------------------------------------------------------
# @accept_subjects — decorator form
# ---------------------------------------------------------------------------


def _make_app() -> Flask:
    app = Flask(__name__)

    @app.route("/account-only")
    @accept_subjects(SubjectType.ACCOUNT)
    def _account_only():
        return "ok"

    @app.route("/external-only")
    @accept_subjects(SubjectType.EXTERNAL_SSO)
    def _external_only():
        return "ok"

    return app


def test_accept_subjects_decorator_passes_on_match():
    app = _make_app()
    with app.test_request_context("/account-only"):
        g.auth_ctx = _account_ctx()
        # Re-route through the decorated function by reaching for view_function
        view = app.view_functions["_account_only"]
        assert view() == "ok"


def test_accept_subjects_decorator_403_on_miss():
    app = _make_app()
    with app.test_request_context("/external-only"):
        g.auth_ctx = _account_ctx()
        view = app.view_functions["_external_only"]
        with patch("controllers.openapi.auth.surface_gate.emit_wrong_surface"):
            with pytest.raises(Forbidden):
                view()


# ---------------------------------------------------------------------------
# SurfaceCheck — pipeline step form
# ---------------------------------------------------------------------------


def _pipeline_ctx() -> Context:
    req = MagicMock()
    req.path = "/openapi/v1/apps/<id>/run"
    return Context(request=req, required_scope=Scope.APPS_RUN)


def test_surface_check_passes_on_match():
    step = SurfaceCheck(accepted=frozenset({SubjectType.ACCOUNT}))
    app = Flask(__name__)
    with app.test_request_context("/openapi/v1/apps/x/run"):
        g.auth_ctx = _account_ctx()
        step(_pipeline_ctx())  # no raise


def test_surface_check_rejects_on_miss_and_emits_audit():
    step = SurfaceCheck(accepted=frozenset({SubjectType.EXTERNAL_SSO}))
    app = Flask(__name__)
    with app.test_request_context("/openapi/v1/apps/x/run"):
        g.auth_ctx = _account_ctx()
        with patch("controllers.openapi.auth.surface_gate.emit_wrong_surface") as emit:
            with pytest.raises(Forbidden):
                step(_pipeline_ctx())
            emit.assert_called_once()


# ---------------------------------------------------------------------------
# _coerce_subject_type — normalises whatever sat on ctx.subject_type
# ---------------------------------------------------------------------------
#
# The gate reads `ctx.subject_type` via `getattr(..., None)`, so the value
# could be a real enum (happy path), a raw string (e.g. rehydrated from a
# dict-shaped context), `None` (attribute missing), or something unexpected
# from a buggy upstream. The coercer must collapse all of that to
# `SubjectType | None` so `check_surface` can do a clean set-membership
# check and emit a clean audit payload.


def test_coerce_subject_type_returns_none_for_none():
    assert _coerce_subject_type(None) is None


def test_coerce_subject_type_returns_enum_instance_unchanged():
    # Identity matters: we don't want to round-trip through the string
    # constructor for an already-valid enum.
    assert _coerce_subject_type(SubjectType.ACCOUNT) is SubjectType.ACCOUNT
    assert _coerce_subject_type(SubjectType.EXTERNAL_SSO) is SubjectType.EXTERNAL_SSO


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("account", SubjectType.ACCOUNT),
        ("external_sso", SubjectType.EXTERNAL_SSO),
    ],
)
def test_coerce_subject_type_parses_known_strings(raw: str, expected: SubjectType):
    assert _coerce_subject_type(raw) is expected


def test_coerce_subject_type_raises_on_unknown_string():
    # Unknown strings reach `SubjectType(raw)` which raises ValueError.
    # We surface that loudly rather than silently returning None, because
    # a string that *looks* like a subject type but isn't is almost
    # certainly an upstream bug worth catching.
    with pytest.raises(ValueError):
        _coerce_subject_type("not_a_subject")


@pytest.mark.parametrize("raw", [123, 1.5, b"account", object(), ["account"], {"account"}])
def test_coerce_subject_type_returns_none_for_non_string_non_enum(raw: object):
    assert _coerce_subject_type(raw) is None
