import base64
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.web.forgot_password import (
    ForgotPasswordCheckApi,
    ForgotPasswordResetApi,
    ForgotPasswordSendEmailApi,
)


@pytest.fixture
def app():
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    return flask_app


@pytest.fixture(autouse=True)
def _patch_wraps():
    wraps_features = SimpleNamespace(enable_email_password_login=True)
    dify_settings = SimpleNamespace(ENTERPRISE_ENABLED=True, EDITION="CLOUD")
    with (
        patch("controllers.console.wraps.db") as mock_db,
        patch("controllers.console.wraps.dify_config", dify_settings),
        patch("controllers.console.wraps.FeatureService.get_system_features", return_value=wraps_features),
    ):
        mock_db.session.query.return_value.first.return_value = MagicMock()
        yield


class TestForgotPasswordSendEmailApi:
    @patch("controllers.web.forgot_password.AccountService.send_reset_password_email")
    @patch("controllers.web.forgot_password.AccountService.get_account_by_email_with_case_fallback")
    @patch("controllers.web.forgot_password.AccountService.is_email_send_ip_limit", return_value=False)
    @patch("controllers.web.forgot_password.extract_remote_ip", return_value="127.0.0.1")
    @patch("controllers.web.forgot_password.Session")
    def test_should_normalize_email_before_sending(
        self,
        mock_session_cls,
        mock_extract_ip,
        mock_rate_limit,
        mock_get_account,
        mock_send_mail,
        app,
    ):
        mock_account = MagicMock()
        mock_get_account.return_value = mock_account
        mock_send_mail.return_value = "token-123"
        mock_session = MagicMock()
        mock_session_cls.return_value.__enter__.return_value = mock_session

        with patch("controllers.web.forgot_password.db", SimpleNamespace(engine="engine")):
            with app.test_request_context(
                "/web/forgot-password",
                method="POST",
                json={"email": "User@Example.com", "language": "zh-Hans"},
            ):
                response = ForgotPasswordSendEmailApi().post()

        assert response == {"result": "success", "data": "token-123"}
        mock_get_account.assert_called_once_with("User@Example.com", session=mock_session)
        mock_send_mail.assert_called_once_with(account=mock_account, email="user@example.com", language="zh-Hans")
        mock_extract_ip.assert_called_once()
        mock_rate_limit.assert_called_once_with("127.0.0.1")


class TestForgotPasswordCheckApi:
    @patch("controllers.web.forgot_password.AccountService.reset_forgot_password_error_rate_limit")
    @patch("controllers.web.forgot_password.AccountService.generate_reset_password_token")
    @patch("controllers.web.forgot_password.AccountService.revoke_reset_password_token")
    @patch("controllers.web.forgot_password.AccountService.add_forgot_password_error_rate_limit")
    @patch("controllers.web.forgot_password.AccountService.get_reset_password_data")
    @patch("controllers.web.forgot_password.AccountService.is_forgot_password_error_rate_limit")
    def test_should_normalize_email_for_validity_checks(
        self,
        mock_is_rate_limit,
        mock_get_data,
        mock_add_rate,
        mock_revoke_token,
        mock_generate_token,
        mock_reset_rate,
        app,
    ):
        mock_is_rate_limit.return_value = False
        mock_get_data.return_value = {"email": "User@Example.com", "code": "1234"}
        mock_generate_token.return_value = (None, "new-token")

        with app.test_request_context(
            "/web/forgot-password/validity",
            method="POST",
            json={"email": "User@Example.com", "code": "1234", "token": "token-123"},
        ):
            response = ForgotPasswordCheckApi().post()

        assert response == {"is_valid": True, "email": "user@example.com", "token": "new-token"}
        mock_is_rate_limit.assert_called_once_with("user@example.com")
        mock_add_rate.assert_not_called()
        mock_revoke_token.assert_called_once_with("token-123")
        mock_generate_token.assert_called_once_with(
            "User@Example.com",
            code="1234",
            additional_data={"phase": "reset"},
        )
        mock_reset_rate.assert_called_once_with("user@example.com")

    @patch("controllers.web.forgot_password.AccountService.reset_forgot_password_error_rate_limit")
    @patch("controllers.web.forgot_password.AccountService.generate_reset_password_token")
    @patch("controllers.web.forgot_password.AccountService.revoke_reset_password_token")
    @patch("controllers.web.forgot_password.AccountService.get_reset_password_data")
    @patch("controllers.web.forgot_password.AccountService.is_forgot_password_error_rate_limit")
    def test_should_preserve_token_email_case(
        self,
        mock_is_rate_limit,
        mock_get_data,
        mock_revoke_token,
        mock_generate_token,
        mock_reset_rate,
        app,
    ):
        mock_is_rate_limit.return_value = False
        mock_get_data.return_value = {"email": "MixedCase@Example.com", "code": "5678"}
        mock_generate_token.return_value = (None, "fresh-token")

        with app.test_request_context(
            "/web/forgot-password/validity",
            method="POST",
            json={"email": "mixedcase@example.com", "code": "5678", "token": "token-upper"},
        ):
            response = ForgotPasswordCheckApi().post()

        assert response == {"is_valid": True, "email": "mixedcase@example.com", "token": "fresh-token"}
        mock_generate_token.assert_called_once_with(
            "MixedCase@Example.com",
            code="5678",
            additional_data={"phase": "reset"},
        )
        mock_revoke_token.assert_called_once_with("token-upper")
        mock_reset_rate.assert_called_once_with("mixedcase@example.com")


class TestForgotPasswordResetApi:
    @patch("controllers.web.forgot_password.ForgotPasswordResetApi._update_existing_account")
    @patch("controllers.web.forgot_password.AccountService.get_account_by_email_with_case_fallback")
    @patch("controllers.web.forgot_password.Session")
    @patch("controllers.web.forgot_password.AccountService.revoke_reset_password_token")
    @patch("controllers.web.forgot_password.AccountService.get_reset_password_data")
    def test_should_fetch_account_with_fallback(
        self,
        mock_get_reset_data,
        mock_revoke_token,
        mock_session_cls,
        mock_get_account,
        mock_update_account,
        app,
    ):
        mock_get_reset_data.return_value = {"phase": "reset", "email": "User@Example.com", "code": "1234"}
        mock_account = MagicMock()
        mock_get_account.return_value = mock_account
        mock_session = MagicMock()
        mock_session_cls.return_value.__enter__.return_value = mock_session

        with patch("controllers.web.forgot_password.db", SimpleNamespace(engine="engine")):
            with app.test_request_context(
                "/web/forgot-password/resets",
                method="POST",
                json={
                    "token": "token-123",
                    "new_password": "ValidPass123!",
                    "password_confirm": "ValidPass123!",
                },
            ):
                response = ForgotPasswordResetApi().post()

        assert response == {"result": "success"}
        mock_get_account.assert_called_once_with("User@Example.com", session=mock_session)
        mock_update_account.assert_called_once()
        mock_revoke_token.assert_called_once_with("token-123")

    @patch("controllers.web.forgot_password.hash_password", return_value=b"hashed-value")
    @patch("controllers.web.forgot_password.secrets.token_bytes", return_value=b"0123456789abcdef")
    @patch("controllers.web.forgot_password.Session")
    @patch("controllers.web.forgot_password.AccountService.revoke_reset_password_token")
    @patch("controllers.web.forgot_password.AccountService.get_reset_password_data")
    @patch("controllers.web.forgot_password.AccountService.get_account_by_email_with_case_fallback")
    def test_should_update_password_and_commit(
        self,
        mock_get_account,
        mock_get_reset_data,
        mock_revoke_token,
        mock_session_cls,
        mock_token_bytes,
        mock_hash_password,
        app,
    ):
        mock_get_reset_data.return_value = {"phase": "reset", "email": "user@example.com"}
        account = MagicMock()
        mock_get_account.return_value = account
        mock_session = MagicMock()
        mock_session_cls.return_value.__enter__.return_value = mock_session

        with patch("controllers.web.forgot_password.db", SimpleNamespace(engine="engine")):
            with app.test_request_context(
                "/web/forgot-password/resets",
                method="POST",
                json={
                    "token": "reset-token",
                    "new_password": "StrongPass123!",
                    "password_confirm": "StrongPass123!",
                },
            ):
                response = ForgotPasswordResetApi().post()

        assert response == {"result": "success"}
        mock_get_reset_data.assert_called_once_with("reset-token")
        mock_revoke_token.assert_called_once_with("reset-token")
        mock_token_bytes.assert_called_once_with(16)
        mock_hash_password.assert_called_once_with("StrongPass123!", b"0123456789abcdef")
        expected_password = base64.b64encode(b"hashed-value").decode()
        assert account.password == expected_password
        expected_salt = base64.b64encode(b"0123456789abcdef").decode()
        assert account.password_salt == expected_salt
        mock_session.commit.assert_called_once()
