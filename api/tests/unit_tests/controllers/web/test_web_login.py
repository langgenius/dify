import base64
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.web.login import EmailCodeLoginApi, EmailCodeLoginSendEmailApi


def encode_code(code: str) -> str:
    return base64.b64encode(code.encode("utf-8")).decode()


@pytest.fixture
def app():
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    return flask_app


@pytest.fixture(autouse=True)
def _patch_wraps():
    wraps_features = SimpleNamespace(enable_email_password_login=True)
    console_dify = SimpleNamespace(ENTERPRISE_ENABLED=True, EDITION="CLOUD")
    web_dify = SimpleNamespace(ENTERPRISE_ENABLED=True)
    with (
        patch("controllers.console.wraps.db") as mock_db,
        patch("controllers.console.wraps.dify_config", console_dify),
        patch("controllers.console.wraps.FeatureService.get_system_features", return_value=wraps_features),
        patch("controllers.web.login.dify_config", web_dify),
    ):
        mock_db.session.query.return_value.first.return_value = MagicMock()
        yield


class TestEmailCodeLoginSendEmailApi:
    @patch("controllers.web.login.WebAppAuthService.send_email_code_login_email")
    @patch("controllers.web.login.WebAppAuthService.get_user_through_email")
    def test_should_fetch_account_with_original_email(
        self,
        mock_get_user,
        mock_send_email,
        app,
    ):
        mock_account = MagicMock()
        mock_get_user.return_value = mock_account
        mock_send_email.return_value = "token-123"

        with app.test_request_context(
            "/web/email-code-login",
            method="POST",
            json={"email": "User@Example.com", "language": "en-US"},
        ):
            response = EmailCodeLoginSendEmailApi().post()

        assert response == {"result": "success", "data": "token-123"}
        mock_get_user.assert_called_once_with("User@Example.com")
        mock_send_email.assert_called_once_with(account=mock_account, language="en-US")


class TestEmailCodeLoginApi:
    @patch("controllers.web.login.AccountService.reset_login_error_rate_limit")
    @patch("controllers.web.login.WebAppAuthService.login", return_value="new-access-token")
    @patch("controllers.web.login.WebAppAuthService.get_user_through_email")
    @patch("controllers.web.login.WebAppAuthService.revoke_email_code_login_token")
    @patch("controllers.web.login.WebAppAuthService.get_email_code_login_data")
    def test_should_normalize_email_before_validating(
        self,
        mock_get_token_data,
        mock_revoke_token,
        mock_get_user,
        mock_login,
        mock_reset_login_rate,
        app,
    ):
        mock_get_token_data.return_value = {"email": "User@Example.com", "code": "123456"}
        mock_get_user.return_value = MagicMock()

        with app.test_request_context(
            "/web/email-code-login/validity",
            method="POST",
            json={"email": "User@Example.com", "code": encode_code("123456"), "token": "token-123"},
        ):
            response = EmailCodeLoginApi().post()

        assert response.get_json() == {"result": "success", "data": {"access_token": "new-access-token"}}
        mock_get_user.assert_called_once_with("User@Example.com")
        mock_revoke_token.assert_called_once_with("token-123")
        mock_login.assert_called_once()
        mock_reset_login_rate.assert_called_once_with("user@example.com")
