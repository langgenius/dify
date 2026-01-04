"""Unit tests for controllers.web.forgot_password endpoints."""

from __future__ import annotations

import base64
import builtins
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from flask.views import MethodView

# Ensure flask_restx.api finds MethodView during import.
if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


def _load_controller_module():
    """Import controllers.web.forgot_password using a stub package."""

    import importlib
    import importlib.util
    import sys
    from types import ModuleType

    parent_module_name = "controllers.web"
    module_name = f"{parent_module_name}.forgot_password"

    if parent_module_name not in sys.modules:
        from flask_restx import Namespace

        stub = ModuleType(parent_module_name)
        stub.__file__ = "controllers/web/__init__.py"
        stub.__path__ = ["controllers/web"]
        stub.__package__ = "controllers"
        stub.__spec__ = importlib.util.spec_from_loader(parent_module_name, loader=None, is_package=True)
        stub.web_ns = Namespace("web", description="Web API", path="/")
        sys.modules[parent_module_name] = stub

    return importlib.import_module(module_name)


forgot_password_module = _load_controller_module()
ForgotPasswordCheckApi = forgot_password_module.ForgotPasswordCheckApi
ForgotPasswordResetApi = forgot_password_module.ForgotPasswordResetApi
ForgotPasswordSendEmailApi = forgot_password_module.ForgotPasswordSendEmailApi


@pytest.fixture
def app() -> Flask:
    """Configure a minimal Flask app for request contexts."""

    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.fixture(autouse=True)
def _enable_web_endpoint_guards():
    """Stub enterprise and feature toggles used by route decorators."""

    features = SimpleNamespace(enable_email_password_login=True)
    with (
        patch("controllers.console.wraps.dify_config.ENTERPRISE_ENABLED", True),
        patch("controllers.console.wraps.dify_config.EDITION", "CLOUD"),
        patch("controllers.console.wraps.FeatureService.get_system_features", return_value=features),
    ):
        yield


@pytest.fixture(autouse=True)
def _mock_controller_db():
    """Replace controller-level db reference with a simple stub."""

    fake_db = SimpleNamespace(engine=MagicMock(name="engine"))
    fake_wraps_db = SimpleNamespace(
        session=MagicMock(query=MagicMock(return_value=MagicMock(first=MagicMock(return_value=True))))
    )
    with (
        patch("controllers.web.forgot_password.db", fake_db),
        patch("controllers.console.wraps.db", fake_wraps_db),
    ):
        yield fake_db


@patch("controllers.web.forgot_password.AccountService.send_reset_password_email", return_value="reset-token")
@patch("controllers.web.forgot_password.Session")
@patch("controllers.web.forgot_password.AccountService.is_email_send_ip_limit", return_value=False)
@patch("controllers.web.forgot_password.extract_remote_ip", return_value="203.0.113.10")
def test_send_reset_email_success(
    mock_extract_ip: MagicMock,
    mock_is_ip_limit: MagicMock,
    mock_session: MagicMock,
    mock_send_email: MagicMock,
    app: Flask,
):
    """POST /forgot-password returns token when email exists and limits allow."""

    mock_account = MagicMock()
    session_ctx = MagicMock()
    mock_session.return_value.__enter__.return_value = session_ctx
    session_ctx.execute.return_value.scalar_one_or_none.return_value = mock_account

    with app.test_request_context(
        "/forgot-password",
        method="POST",
        json={"email": "user@example.com"},
    ):
        response = ForgotPasswordSendEmailApi().post()

    assert response == {"result": "success", "data": "reset-token"}
    mock_extract_ip.assert_called_once()
    mock_is_ip_limit.assert_called_once_with("203.0.113.10")
    mock_send_email.assert_called_once_with(account=mock_account, email="user@example.com", language="en-US")


@patch("controllers.web.forgot_password.AccountService.reset_forgot_password_error_rate_limit")
@patch("controllers.web.forgot_password.AccountService.generate_reset_password_token", return_value=({}, "new-token"))
@patch("controllers.web.forgot_password.AccountService.revoke_reset_password_token")
@patch("controllers.web.forgot_password.AccountService.get_reset_password_data")
@patch("controllers.web.forgot_password.AccountService.is_forgot_password_error_rate_limit", return_value=False)
def test_check_token_success(
    mock_is_rate_limited: MagicMock,
    mock_get_data: MagicMock,
    mock_revoke: MagicMock,
    mock_generate: MagicMock,
    mock_reset_limit: MagicMock,
    app: Flask,
):
    """POST /forgot-password/validity validates the code and refreshes token."""

    mock_get_data.return_value = {"email": "user@example.com", "code": "123456"}

    with app.test_request_context(
        "/forgot-password/validity",
        method="POST",
        json={"email": "user@example.com", "code": "123456", "token": "old-token"},
    ):
        response = ForgotPasswordCheckApi().post()

    assert response == {"is_valid": True, "email": "user@example.com", "token": "new-token"}
    mock_is_rate_limited.assert_called_once_with("user@example.com")
    mock_get_data.assert_called_once_with("old-token")
    mock_revoke.assert_called_once_with("old-token")
    mock_generate.assert_called_once_with(
        "user@example.com",
        code="123456",
        additional_data={"phase": "reset"},
    )
    mock_reset_limit.assert_called_once_with("user@example.com")


@patch("controllers.web.forgot_password.hash_password", return_value=b"hashed-value")
@patch("controllers.web.forgot_password.secrets.token_bytes", return_value=b"0123456789abcdef")
@patch("controllers.web.forgot_password.Session")
@patch("controllers.web.forgot_password.AccountService.revoke_reset_password_token")
@patch("controllers.web.forgot_password.AccountService.get_reset_password_data")
def test_reset_password_success(
    mock_get_data: MagicMock,
    mock_revoke_token: MagicMock,
    mock_session: MagicMock,
    mock_token_bytes: MagicMock,
    mock_hash_password: MagicMock,
    app: Flask,
):
    """POST /forgot-password/resets updates the stored password when token is valid."""

    mock_get_data.return_value = {"email": "user@example.com", "phase": "reset"}
    account = MagicMock()
    session_ctx = MagicMock()
    mock_session.return_value.__enter__.return_value = session_ctx
    session_ctx.execute.return_value.scalar_one_or_none.return_value = account

    with app.test_request_context(
        "/forgot-password/resets",
        method="POST",
        json={
            "token": "reset-token",
            "new_password": "StrongPass123!",
            "password_confirm": "StrongPass123!",
        },
    ):
        response = ForgotPasswordResetApi().post()

    assert response == {"result": "success"}
    mock_get_data.assert_called_once_with("reset-token")
    mock_revoke_token.assert_called_once_with("reset-token")
    mock_token_bytes.assert_called_once_with(16)
    mock_hash_password.assert_called_once_with("StrongPass123!", b"0123456789abcdef")
    expected_password = base64.b64encode(b"hashed-value").decode()
    assert account.password == expected_password
    expected_salt = base64.b64encode(b"0123456789abcdef").decode()
    assert account.password_salt == expected_salt
    session_ctx.commit.assert_called_once()
