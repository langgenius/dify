from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console.auth.forgot_password import (
    ForgotPasswordCheckApi,
    ForgotPasswordResetApi,
    ForgotPasswordSendEmailApi,
)
from services.account_service import AccountService


@pytest.fixture
def app():
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    return flask_app


class TestForgotPasswordSendEmailApi:
    @patch("controllers.console.auth.forgot_password.Session")
    @patch("controllers.console.auth.forgot_password.AccountService.get_account_by_email_with_case_fallback")
    @patch("controllers.console.auth.forgot_password.AccountService.send_reset_password_email")
    @patch("controllers.console.auth.forgot_password.AccountService.is_email_send_ip_limit", return_value=False)
    @patch("controllers.console.auth.forgot_password.extract_remote_ip", return_value="127.0.0.1")
    def test_send_normalizes_email(
        self,
        mock_extract_ip,
        mock_is_ip_limit,
        mock_send_email,
        mock_get_account,
        mock_session_cls,
        app,
    ):
        mock_account = MagicMock()
        mock_get_account.return_value = mock_account
        mock_send_email.return_value = "token-123"
        mock_session = MagicMock()
        mock_session_cls.return_value.__enter__.return_value = mock_session

        wraps_features = SimpleNamespace(enable_email_password_login=True, is_allow_register=True)
        controller_features = SimpleNamespace(is_allow_register=True)
        with (
            patch("controllers.console.auth.forgot_password.db", SimpleNamespace(engine="engine")),
            patch(
                "controllers.console.auth.forgot_password.FeatureService.get_system_features",
                return_value=controller_features,
            ),
            patch("controllers.console.wraps.dify_config", SimpleNamespace(EDITION="CLOUD")),
            patch("controllers.console.wraps.FeatureService.get_system_features", return_value=wraps_features),
        ):
            with app.test_request_context(
                "/forgot-password",
                method="POST",
                json={"email": "User@Example.com", "language": "zh-Hans"},
            ):
                response = ForgotPasswordSendEmailApi().post()

        assert response == {"result": "success", "data": "token-123"}
        mock_get_account.assert_called_once_with("User@Example.com", session=mock_session)
        mock_send_email.assert_called_once_with(
            account=mock_account,
            email="user@example.com",
            language="zh-Hans",
            is_allow_register=True,
        )
        mock_is_ip_limit.assert_called_once_with("127.0.0.1")
        mock_extract_ip.assert_called_once()


class TestForgotPasswordCheckApi:
    @patch("controllers.console.auth.forgot_password.AccountService.reset_forgot_password_error_rate_limit")
    @patch("controllers.console.auth.forgot_password.AccountService.generate_reset_password_token")
    @patch("controllers.console.auth.forgot_password.AccountService.revoke_reset_password_token")
    @patch("controllers.console.auth.forgot_password.AccountService.add_forgot_password_error_rate_limit")
    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    @patch("controllers.console.auth.forgot_password.AccountService.is_forgot_password_error_rate_limit")
    def test_check_normalizes_email(
        self,
        mock_rate_limit_check,
        mock_get_data,
        mock_add_rate,
        mock_revoke_token,
        mock_generate_token,
        mock_reset_rate,
        app,
    ):
        mock_rate_limit_check.return_value = False
        mock_get_data.return_value = {"email": "Admin@Example.com", "code": "4321"}
        mock_generate_token.return_value = (None, "new-token")

        wraps_features = SimpleNamespace(enable_email_password_login=True)
        with (
            patch("controllers.console.wraps.dify_config", SimpleNamespace(EDITION="CLOUD")),
            patch("controllers.console.wraps.FeatureService.get_system_features", return_value=wraps_features),
        ):
            with app.test_request_context(
                "/forgot-password/validity",
                method="POST",
                json={"email": "ADMIN@Example.com", "code": "4321", "token": "token-123"},
            ):
                response = ForgotPasswordCheckApi().post()

        assert response == {"is_valid": True, "email": "admin@example.com", "token": "new-token"}
        mock_rate_limit_check.assert_called_once_with("admin@example.com")
        mock_generate_token.assert_called_once_with(
            "Admin@Example.com",
            code="4321",
            additional_data={"phase": "reset"},
        )
        mock_reset_rate.assert_called_once_with("admin@example.com")
        mock_add_rate.assert_not_called()
        mock_revoke_token.assert_called_once_with("token-123")


class TestForgotPasswordResetApi:
    @patch("controllers.console.auth.forgot_password.ForgotPasswordResetApi._update_existing_account")
    @patch("controllers.console.auth.forgot_password.Session")
    @patch("controllers.console.auth.forgot_password.AccountService.get_account_by_email_with_case_fallback")
    @patch("controllers.console.auth.forgot_password.AccountService.revoke_reset_password_token")
    @patch("controllers.console.auth.forgot_password.AccountService.get_reset_password_data")
    def test_reset_fetches_account_with_original_email(
        self,
        mock_get_reset_data,
        mock_revoke_token,
        mock_get_account,
        mock_session_cls,
        mock_update_account,
        app,
    ):
        mock_get_reset_data.return_value = {"phase": "reset", "email": "User@Example.com"}
        mock_account = MagicMock()
        mock_get_account.return_value = mock_account

        mock_session = MagicMock()
        mock_session_cls.return_value.__enter__.return_value = mock_session

        wraps_features = SimpleNamespace(enable_email_password_login=True)
        with (
            patch("controllers.console.auth.forgot_password.db", SimpleNamespace(engine="engine")),
            patch("controllers.console.wraps.dify_config", SimpleNamespace(EDITION="CLOUD")),
            patch("controllers.console.wraps.FeatureService.get_system_features", return_value=wraps_features),
        ):
            with app.test_request_context(
                "/forgot-password/resets",
                method="POST",
                json={
                    "token": "token-123",
                    "new_password": "ValidPass123!",
                    "password_confirm": "ValidPass123!",
                },
            ):
                response = ForgotPasswordResetApi().post()

        assert response == {"result": "success"}
        mock_get_reset_data.assert_called_once_with("token-123")
        mock_revoke_token.assert_called_once_with("token-123")
        mock_get_account.assert_called_once_with("User@Example.com", session=mock_session)
        mock_update_account.assert_called_once()


def test_get_account_by_email_with_case_fallback_uses_lowercase_lookup():
    mock_session = MagicMock()
    first_query = MagicMock()
    first_query.scalar_one_or_none.return_value = None
    expected_account = MagicMock()
    second_query = MagicMock()
    second_query.scalar_one_or_none.return_value = expected_account
    mock_session.execute.side_effect = [first_query, second_query]

    account = AccountService.get_account_by_email_with_case_fallback("Mixed@Test.com", session=mock_session)

    assert account is expected_account
    assert mock_session.execute.call_count == 2
