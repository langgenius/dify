from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console.auth.oauth import OAuthLogin, _generate_account
from libs.oauth import OAuthUserInfo
from services.errors.account import AccountRegisterError


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@patch("controllers.console.auth.oauth.redirect")
@patch("controllers.console.auth.oauth.get_oauth_providers")
def test_oauth_login_passes_language_and_timezone_to_authorization_url(
    mock_get_oauth_providers,
    mock_redirect,
    app: Flask,
):
    oauth_provider = MagicMock()
    oauth_provider.get_authorization_url.return_value = "https://github.com/login/oauth/authorize?state=..."
    mock_get_oauth_providers.return_value = {"github": oauth_provider}

    with app.test_request_context("/oauth/login/github?language=zh-Hans&timezone=Asia/Shanghai"):
        OAuthLogin().get("github")

    oauth_provider.get_authorization_url.assert_called_once_with(
        invite_token=None,
        timezone="Asia/Shanghai",
        language="zh-Hans",
    )
    mock_redirect.assert_called_once_with("https://github.com/login/oauth/authorize?state=...")


@patch("controllers.console.auth.oauth.AccountService.link_account_integrate")
@patch("controllers.console.auth.oauth.RegisterService")
@patch("controllers.console.auth.oauth.FeatureService")
@patch("controllers.console.auth.oauth._get_account_by_openid_or_email", return_value=None)
def test_generate_account_registers_with_browser_timezone(
    mock_get_account,
    mock_feature_service,
    mock_register_service,
    mock_link_account,
    app: Flask,
):
    account = MagicMock()
    mock_register_service.register.return_value = account
    mock_feature_service.get_system_features.return_value.is_allow_register = True
    user_info = OAuthUserInfo(id="github-123", name="Test User", email="User@Example.com")

    with app.test_request_context(headers={"Accept-Language": "zh-Hans,zh;q=0.9"}):
        result, oauth_new_user = _generate_account("github", user_info, timezone="Asia/Shanghai")

    assert result is account
    assert oauth_new_user is True
    mock_register_service.register.assert_called_once_with(
        email="user@example.com",
        name="Test User",
        password=None,
        open_id="github-123",
        provider="github",
        language="zh-Hans",
        timezone="Asia/Shanghai",
    )
    mock_link_account.assert_called_once_with("github", "github-123", account)


@patch("controllers.console.auth.oauth.AccountService.link_account_integrate")
@patch("controllers.console.auth.oauth.RegisterService")
@patch("controllers.console.auth.oauth.FeatureService")
@patch("controllers.console.auth.oauth._get_account_by_openid_or_email", return_value=None)
def test_generate_account_prefers_state_language_over_accept_language(
    mock_get_account,
    mock_feature_service,
    mock_register_service,
    mock_link_account,
    app: Flask,
):
    account = MagicMock()
    mock_register_service.register.return_value = account
    mock_feature_service.get_system_features.return_value.is_allow_register = True
    user_info = OAuthUserInfo(id="github-123", name="Test User", email="User@Example.com")

    with app.test_request_context(headers={"Accept-Language": "en-US,en;q=0.9"}):
        _generate_account("github", user_info, language="zh-Hans")

    mock_register_service.register.assert_called_once_with(
        email="user@example.com",
        name="Test User",
        password=None,
        open_id="github-123",
        provider="github",
        language="zh-Hans",
        timezone=None,
    )
    mock_link_account.assert_called_once_with("github", "github-123", account)


@patch("controllers.console.auth.oauth.dify_config")
@patch("controllers.console.auth.oauth.RegisterService")
@patch("controllers.console.auth.oauth.FeatureService")
@patch("controllers.console.auth.oauth._get_account_by_openid_or_email", return_value=None)
def test_generate_account_rejects_new_user_when_registration_disabled(
    mock_get_account,
    mock_feature_service,
    mock_register_service,
    mock_config,
    app: Flask,
):
    mock_feature_service.get_system_features.return_value.is_allow_register = False
    mock_config.BILLING_ENABLED = False
    user_info = OAuthUserInfo(id="github-123", name="Test User", email="user@example.com")

    with app.test_request_context(headers={"Accept-Language": "en-US,en;q=0.9"}):
        with pytest.raises(AccountRegisterError):
            _generate_account("github", user_info)

    mock_register_service.register.assert_not_called()
