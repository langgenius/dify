from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console.auth.email_register import (
    EmailRegisterCheckApi,
    EmailRegisterResetApi,
    EmailRegisterSendEmailApi,
)
from services.account_service import AccountService


@pytest.fixture
def app():
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    return flask_app


class TestEmailRegisterSendEmailApi:
    @patch("controllers.console.auth.email_register.Session")
    @patch("controllers.console.auth.email_register.AccountService.get_account_by_email_with_case_fallback")
    @patch("controllers.console.auth.email_register.AccountService.send_email_register_email")
    @patch("controllers.console.auth.email_register.BillingService.is_email_in_freeze")
    @patch("controllers.console.auth.email_register.AccountService.is_email_send_ip_limit", return_value=False)
    @patch("controllers.console.auth.email_register.extract_remote_ip", return_value="127.0.0.1")
    def test_send_email_normalizes_and_falls_back(
        self,
        mock_extract_ip,
        mock_is_email_send_ip_limit,
        mock_is_freeze,
        mock_send_mail,
        mock_get_account,
        mock_session_cls,
        app,
    ):
        mock_send_mail.return_value = "token-123"
        mock_is_freeze.return_value = False
        mock_account = MagicMock()

        mock_session = MagicMock()
        mock_session_cls.return_value.__enter__.return_value = mock_session
        mock_get_account.return_value = mock_account

        feature_flags = SimpleNamespace(enable_email_password_login=True, is_allow_register=True)
        with (
            patch("controllers.console.auth.email_register.db", SimpleNamespace(engine="engine")),
            patch("controllers.console.auth.email_register.dify_config", SimpleNamespace(BILLING_ENABLED=True)),
            patch("controllers.console.wraps.dify_config", SimpleNamespace(EDITION="CLOUD")),
            patch("controllers.console.wraps.FeatureService.get_system_features", return_value=feature_flags),
        ):
            with app.test_request_context(
                "/email-register/send-email",
                method="POST",
                json={"email": "Invitee@Example.com", "language": "en-US"},
            ):
                response = EmailRegisterSendEmailApi().post()

        assert response == {"result": "success", "data": "token-123"}
        mock_is_freeze.assert_called_once_with("invitee@example.com")
        mock_send_mail.assert_called_once_with(email="invitee@example.com", account=mock_account, language="en-US")
        mock_get_account.assert_called_once_with("Invitee@Example.com", session=mock_session)
        mock_extract_ip.assert_called_once()
        mock_is_email_send_ip_limit.assert_called_once_with("127.0.0.1")


class TestEmailRegisterCheckApi:
    @patch("controllers.console.auth.email_register.AccountService.reset_email_register_error_rate_limit")
    @patch("controllers.console.auth.email_register.AccountService.generate_email_register_token")
    @patch("controllers.console.auth.email_register.AccountService.revoke_email_register_token")
    @patch("controllers.console.auth.email_register.AccountService.add_email_register_error_rate_limit")
    @patch("controllers.console.auth.email_register.AccountService.get_email_register_data")
    @patch("controllers.console.auth.email_register.AccountService.is_email_register_error_rate_limit")
    def test_validity_normalizes_email_before_checks(
        self,
        mock_rate_limit_check,
        mock_get_data,
        mock_add_rate,
        mock_revoke,
        mock_generate_token,
        mock_reset_rate,
        app,
    ):
        mock_rate_limit_check.return_value = False
        mock_get_data.return_value = {"email": "User@Example.com", "code": "4321"}
        mock_generate_token.return_value = (None, "new-token")

        feature_flags = SimpleNamespace(enable_email_password_login=True, is_allow_register=True)
        with (
            patch("controllers.console.auth.email_register.db", SimpleNamespace(engine="engine")),
            patch("controllers.console.wraps.dify_config", SimpleNamespace(EDITION="CLOUD")),
            patch("controllers.console.wraps.FeatureService.get_system_features", return_value=feature_flags),
        ):
            with app.test_request_context(
                "/email-register/validity",
                method="POST",
                json={"email": "User@Example.com", "code": "4321", "token": "token-123"},
            ):
                response = EmailRegisterCheckApi().post()

        assert response == {"is_valid": True, "email": "user@example.com", "token": "new-token"}
        mock_rate_limit_check.assert_called_once_with("user@example.com")
        mock_generate_token.assert_called_once_with(
            "user@example.com", code="4321", additional_data={"phase": "register"}
        )
        mock_reset_rate.assert_called_once_with("user@example.com")
        mock_add_rate.assert_not_called()
        mock_revoke.assert_called_once_with("token-123")


class TestEmailRegisterResetApi:
    @patch("controllers.console.auth.email_register.AccountService.reset_login_error_rate_limit")
    @patch("controllers.console.auth.email_register.AccountService.login")
    @patch("controllers.console.auth.email_register.EmailRegisterResetApi._create_new_account")
    @patch("controllers.console.auth.email_register.Session")
    @patch("controllers.console.auth.email_register.AccountService.get_account_by_email_with_case_fallback")
    @patch("controllers.console.auth.email_register.AccountService.revoke_email_register_token")
    @patch("controllers.console.auth.email_register.AccountService.get_email_register_data")
    @patch("controllers.console.auth.email_register.extract_remote_ip", return_value="127.0.0.1")
    def test_reset_creates_account_with_normalized_email(
        self,
        mock_extract_ip,
        mock_get_data,
        mock_revoke_token,
        mock_get_account,
        mock_session_cls,
        mock_create_account,
        mock_login,
        mock_reset_login_rate,
        app,
    ):
        mock_get_data.return_value = {"phase": "register", "email": "Invitee@Example.com"}
        mock_create_account.return_value = MagicMock()
        token_pair = MagicMock()
        token_pair.model_dump.return_value = {"access_token": "a", "refresh_token": "r"}
        mock_login.return_value = token_pair

        mock_session = MagicMock()
        mock_session_cls.return_value.__enter__.return_value = mock_session
        mock_get_account.return_value = None

        feature_flags = SimpleNamespace(enable_email_password_login=True, is_allow_register=True)
        with (
            patch("controllers.console.auth.email_register.db", SimpleNamespace(engine="engine")),
            patch("controllers.console.wraps.dify_config", SimpleNamespace(EDITION="CLOUD")),
            patch("controllers.console.wraps.FeatureService.get_system_features", return_value=feature_flags),
        ):
            with app.test_request_context(
                "/email-register",
                method="POST",
                json={"token": "token-123", "new_password": "ValidPass123!", "password_confirm": "ValidPass123!"},
            ):
                response = EmailRegisterResetApi().post()

        assert response == {"result": "success", "data": {"access_token": "a", "refresh_token": "r"}}
        mock_create_account.assert_called_once_with("invitee@example.com", "ValidPass123!")
        mock_reset_login_rate.assert_called_once_with("invitee@example.com")
        mock_revoke_token.assert_called_once_with("token-123")
        mock_extract_ip.assert_called_once()
        mock_get_account.assert_called_once_with("Invitee@Example.com", session=mock_session)


def test_get_account_by_email_with_case_fallback_uses_lowercase_lookup():
    mock_session = MagicMock()
    first_query = MagicMock()
    first_query.scalar_one_or_none.return_value = None
    expected_account = MagicMock()
    second_query = MagicMock()
    second_query.scalar_one_or_none.return_value = expected_account
    mock_session.execute.side_effect = [first_query, second_query]

    account = AccountService.get_account_by_email_with_case_fallback("Case@Test.com", session=mock_session)

    assert account is expected_account
    assert mock_session.execute.call_count == 2
