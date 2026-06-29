import uuid
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden, NotFound, Unauthorized

from controllers.openapi.auth.data import AuthData, Edition
from controllers.openapi.auth.pipeline import AuthPipeline, PipelineRoute, PipelineRouter
from libs.oauth_bearer import Scope, TokenType


def _make_identity(
    token_type=TokenType.OAUTH_ACCOUNT,
    account_id=None,
    scopes=None,
    token_hash="testhash",
    subject_email=None,
    subject_issuer=None,
    verified_tenants=None,
    token_id=None,
):
    identity = MagicMock()
    identity.token_type = token_type
    identity.account_id = account_id or uuid.uuid4()
    identity.scopes = scopes or frozenset({Scope.FULL})
    identity.token_hash = token_hash
    identity.subject_email = subject_email
    identity.subject_issuer = subject_issuer
    identity.verified_tenants = verified_tenants or {}
    identity.token_id = token_id or uuid.uuid4()
    return identity


@pytest.fixture
def app():
    return Flask(__name__)


def _make_router(token_type=TokenType.OAUTH_ACCOUNT, prepare=None, auth=None):
    pipeline = AuthPipeline(prepare=prepare or [], auth=auth or [])
    return PipelineRouter({token_type: PipelineRoute(pipeline)})


def _fake_identity():
    return _make_identity()


# --- PipelineRouter.guard ---


def test_guard_passes_auth_data_to_view(app):
    router = _make_router()
    received = {}

    with app.test_request_context("/test", headers={"Authorization": "Bearer tok"}):
        with (
            patch("controllers.openapi.auth.pipeline.extract_bearer", return_value="tok"),
            patch("controllers.openapi.auth.pipeline.get_authenticator") as mock_auth,
            patch("controllers.openapi.auth.pipeline.set_auth_ctx", return_value=MagicMock()),
            patch("controllers.openapi.auth.pipeline.reset_auth_ctx"),
        ):
            mock_auth.return_value.authenticate.return_value = _fake_identity()

            @router.guard(scope=Scope.FULL, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
            def view(*, auth_data):
                received["data"] = auth_data

            view()

    assert isinstance(received["data"], AuthData)


def test_guard_edition_gate_returns_404(app):
    router = _make_router()

    with app.test_request_context("/test"):
        with patch("controllers.openapi.auth.pipeline.current_edition", return_value=Edition.CE):

            @router.guard(scope=Scope.FULL, edition=frozenset({Edition.EE}))
            def view(*, auth_data):
                pass

            with pytest.raises(NotFound):
                view()


def test_guard_token_type_gate_returns_403(app):
    router = _make_router()

    with app.test_request_context("/test", headers={"Authorization": "Bearer tok"}):
        with (
            patch("controllers.openapi.auth.pipeline.extract_bearer", return_value="tok"),
            patch("controllers.openapi.auth.pipeline.get_authenticator") as mock_auth,
            patch("controllers.openapi.auth.pipeline.emit_wrong_surface"),
            patch("controllers.openapi.auth.pipeline.current_edition", return_value=Edition.CE),
        ):
            identity = _fake_identity()
            identity.token_type = TokenType.OAUTH_EXTERNAL_SSO
            mock_auth.return_value.authenticate.return_value = identity

            @router.guard(scope=Scope.FULL, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
            def view(*, auth_data):
                pass

            with pytest.raises(Forbidden):
                view()


def test_guard_unregistered_token_type_returns_403(app):
    router = _make_router(token_type=TokenType.OAUTH_ACCOUNT)

    with app.test_request_context("/test", headers={"Authorization": "Bearer tok"}):
        with (
            patch("controllers.openapi.auth.pipeline.extract_bearer", return_value="tok"),
            patch("controllers.openapi.auth.pipeline.get_authenticator") as mock_auth,
            patch("controllers.openapi.auth.pipeline.current_edition", return_value=Edition.CE),
        ):
            identity = _fake_identity()
            identity.token_type = TokenType.OAUTH_EXTERNAL_SSO
            mock_auth.return_value.authenticate.return_value = identity

            @router.guard(scope=Scope.FULL)
            def view(*, auth_data):
                pass

            with pytest.raises(Forbidden):
                view()


def test_guard_no_bearer_returns_401(app):
    router = _make_router()

    with app.test_request_context("/test"):
        with patch("controllers.openapi.auth.pipeline.extract_bearer", return_value=None):

            @router.guard(scope=Scope.FULL)
            def view(*, auth_data):
                pass

            with pytest.raises(Unauthorized):
                view()


def test_guard_runs_prepare_steps_in_order(app):
    order = []

    def p1(b):
        order.append("p1")

    def p2(b):
        order.append("p2")

    router = _make_router(prepare=[p1, p2])

    with app.test_request_context("/test", headers={"Authorization": "Bearer tok"}):
        with (
            patch("controllers.openapi.auth.pipeline.extract_bearer", return_value="tok"),
            patch("controllers.openapi.auth.pipeline.get_authenticator") as mock_auth,
            patch("controllers.openapi.auth.pipeline.set_auth_ctx", return_value=MagicMock()),
            patch("controllers.openapi.auth.pipeline.reset_auth_ctx"),
        ):
            mock_auth.return_value.authenticate.return_value = _fake_identity()

            @router.guard(scope=Scope.FULL)
            def view(*, auth_data):
                pass

            view()

    assert order == ["p1", "p2"]


def test_guard_resets_auth_ctx_on_exception(app):
    router = _make_router()
    reset_called = []

    with app.test_request_context("/test", headers={"Authorization": "Bearer tok"}):
        with (
            patch("controllers.openapi.auth.pipeline.extract_bearer", return_value="tok"),
            patch("controllers.openapi.auth.pipeline.get_authenticator") as mock_auth,
            patch("controllers.openapi.auth.pipeline.set_auth_ctx", return_value="tok"),
            patch("controllers.openapi.auth.pipeline.reset_auth_ctx", side_effect=lambda t: reset_called.append(t)),
        ):
            mock_auth.return_value.authenticate.return_value = _fake_identity()

            @router.guard(scope=Scope.FULL)
            def view(*, auth_data):
                raise RuntimeError("boom")

            with pytest.raises(RuntimeError):
                view()

    assert reset_called == ["tok"]


def test_router_rejects_token_type_on_wrong_edition(app):
    pipeline = AuthPipeline(prepare=[], auth=[])
    route = PipelineRoute(pipeline, required_edition=frozenset({Edition.EE}))
    router = PipelineRouter({TokenType.OAUTH_EXTERNAL_SSO: route})

    with app.test_request_context("/test", headers={"Authorization": "Bearer tok"}):
        with (
            patch("controllers.openapi.auth.pipeline.extract_bearer", return_value="tok"),
            patch("controllers.openapi.auth.pipeline.get_authenticator") as mock_auth,
            patch("controllers.openapi.auth.pipeline.current_edition", return_value=Edition.CE),
        ):
            identity = _make_identity(token_type=TokenType.OAUTH_EXTERNAL_SSO)
            mock_auth.return_value.authenticate.return_value = identity

            @router.guard(scope=Scope.APPS_RUN)
            def view(*, auth_data):
                pass

            with pytest.raises(Forbidden):
                view()


def test_guard_populates_external_identity_from_subject_email(app):
    from controllers.openapi.auth.data import ExternalIdentity

    router = _make_router(token_type=TokenType.OAUTH_EXTERNAL_SSO)
    received = {}

    with app.test_request_context("/test", headers={"Authorization": "Bearer tok"}):
        with (
            patch("controllers.openapi.auth.pipeline.extract_bearer", return_value="tok"),
            patch("controllers.openapi.auth.pipeline.get_authenticator") as mock_auth,
            patch("controllers.openapi.auth.pipeline.set_auth_ctx", return_value=MagicMock()),
            patch("controllers.openapi.auth.pipeline.reset_auth_ctx"),
        ):
            identity = _make_identity(
                token_type=TokenType.OAUTH_EXTERNAL_SSO,
                subject_email="user@sso.com",
                subject_issuer="https://idp.example.com",
            )
            mock_auth.return_value.authenticate.return_value = identity

            @router.guard(scope=Scope.FULL, allowed_token_types=frozenset({TokenType.OAUTH_EXTERNAL_SSO}))
            def view(*, auth_data):
                received["data"] = auth_data

            view()

    assert isinstance(received["data"].external_identity, ExternalIdentity)
    assert received["data"].external_identity.email == "user@sso.com"
    assert received["data"].external_identity.issuer == "https://idp.example.com"


def test_guard_workspace_sets_membership_and_roles(app):
    from models.account import TenantAccountRole

    router = _make_router()
    received = {}

    with app.test_request_context("/test", headers={"Authorization": "Bearer tok"}):
        with (
            patch("controllers.openapi.auth.pipeline.extract_bearer", return_value="tok"),
            patch("controllers.openapi.auth.pipeline.get_authenticator") as mock_auth,
            patch("controllers.openapi.auth.pipeline.set_auth_ctx", return_value=MagicMock()),
            patch("controllers.openapi.auth.pipeline.reset_auth_ctx"),
        ):
            mock_auth.return_value.authenticate.return_value = _fake_identity()

            roles = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN})

            @router.guard_workspace(
                scope=Scope.FULL,
                allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
                allowed_roles=roles,
            )
            def view(*, auth_data):
                received["data"] = auth_data

            view()

    assert isinstance(received["data"], AuthData)
    assert received["data"].allowed_roles == roles


def test_guard_workspace_without_roles(app):
    router = _make_router()
    received = {}

    with app.test_request_context("/test", headers={"Authorization": "Bearer tok"}):
        with (
            patch("controllers.openapi.auth.pipeline.extract_bearer", return_value="tok"),
            patch("controllers.openapi.auth.pipeline.get_authenticator") as mock_auth,
            patch("controllers.openapi.auth.pipeline.set_auth_ctx", return_value=MagicMock()),
            patch("controllers.openapi.auth.pipeline.reset_auth_ctx"),
        ):
            mock_auth.return_value.authenticate.return_value = _fake_identity()

            @router.guard_workspace(scope=Scope.FULL)
            def view(*, auth_data):
                received["data"] = auth_data

            view()

    assert isinstance(received["data"], AuthData)
    assert received["data"].allowed_roles is None


def test_guard_no_external_identity_when_subject_email_absent(app):
    router = _make_router()
    received = {}

    with app.test_request_context("/test", headers={"Authorization": "Bearer tok"}):
        with (
            patch("controllers.openapi.auth.pipeline.extract_bearer", return_value="tok"),
            patch("controllers.openapi.auth.pipeline.get_authenticator") as mock_auth,
            patch("controllers.openapi.auth.pipeline.set_auth_ctx", return_value=MagicMock()),
            patch("controllers.openapi.auth.pipeline.reset_auth_ctx"),
        ):
            mock_auth.return_value.authenticate.return_value = _make_identity(subject_email=None)

            @router.guard(scope=Scope.FULL, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
            def view(*, auth_data):
                received["data"] = auth_data

            view()

    assert received["data"].external_identity is None


# --- auth-failure mapping (no raw 500 leak) ---


def test_guard_expired_token_raises_session_expired_401(app):
    from controllers.openapi._errors import OpenApiErrorCode, SessionExpired
    from libs.oauth_bearer import TokenExpiredError

    router = _make_router()

    with app.test_request_context("/test", headers={"Authorization": "Bearer tok"}):
        with (
            patch("controllers.openapi.auth.pipeline.extract_bearer", return_value="tok"),
            patch("controllers.openapi.auth.pipeline.get_authenticator") as mock_auth,
            patch("controllers.openapi.auth.pipeline.current_edition", return_value=Edition.CE),
        ):
            mock_auth.return_value.authenticate.side_effect = TokenExpiredError("token_expired")

            @router.guard(scope=Scope.FULL)
            def view(*, auth_data):
                pass

            with pytest.raises(SessionExpired) as exc:
                view()

    assert exc.value.code == 401
    assert exc.value.error_code == OpenApiErrorCode.TOKEN_EXPIRED


def test_guard_invalid_token_raises_unified_401_not_500(app):
    from controllers.openapi._errors import InvalidBearer, OpenApiErrorCode
    from libs.oauth_bearer import InvalidBearerError

    router = _make_router()

    with app.test_request_context("/test", headers={"Authorization": "Bearer tok"}):
        with (
            patch("controllers.openapi.auth.pipeline.extract_bearer", return_value="tok"),
            patch("controllers.openapi.auth.pipeline.get_authenticator") as mock_auth,
            patch("controllers.openapi.auth.pipeline.current_edition", return_value=Edition.CE),
        ):
            mock_auth.return_value.authenticate.side_effect = InvalidBearerError("invalid_bearer")

            @router.guard(scope=Scope.FULL)
            def view(*, auth_data):
                pass

            with pytest.raises(InvalidBearer) as exc:
                view()

    assert exc.value.code == 401
    assert exc.value.error_code == OpenApiErrorCode.UNAUTHORIZED
