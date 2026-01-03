from unittest.mock import patch


def test_get_system_features_acedatacloud_login_exclusive():
    with patch("services.feature_service.dify_config") as mock_config:
        mock_config.ENTERPRISE_ENABLED = False
        mock_config.MARKETPLACE_ENABLED = False
        mock_config.ENABLE_EMAIL_CODE_LOGIN = True
        mock_config.ENABLE_EMAIL_PASSWORD_LOGIN = True
        mock_config.ENABLE_SOCIAL_OAUTH_LOGIN = True
        mock_config.ACEDATACLOUD_AUTH_BASE_URL = "https://auth.acedata.cloud"
        mock_config.ENABLE_ACEDATACLOUD_OAUTH_LOGIN = True
        mock_config.ALLOW_REGISTER = True
        mock_config.ALLOW_CREATE_WORKSPACE = True
        mock_config.MAIL_TYPE = "smtp"
        mock_config.PLUGIN_MAX_PACKAGE_SIZE = 50

        from services.feature_service import FeatureService

        result = FeatureService.get_system_features()

        assert result.enable_acedatacloud_oauth_login is True
        assert result.enable_email_code_login is False
        assert result.enable_email_password_login is False
        assert result.enable_social_oauth_login is False
        assert result.sso_enforced_for_signin is False
        assert result.sso_enforced_for_signin_protocol == ""


def test_get_system_features_acedatacloud_login_requires_base_url():
    with patch("services.feature_service.dify_config") as mock_config:
        mock_config.ENTERPRISE_ENABLED = False
        mock_config.MARKETPLACE_ENABLED = False
        mock_config.ENABLE_EMAIL_CODE_LOGIN = True
        mock_config.ENABLE_EMAIL_PASSWORD_LOGIN = True
        mock_config.ENABLE_SOCIAL_OAUTH_LOGIN = True
        mock_config.ACEDATACLOUD_AUTH_BASE_URL = ""
        mock_config.ENABLE_ACEDATACLOUD_OAUTH_LOGIN = True
        mock_config.ALLOW_REGISTER = True
        mock_config.ALLOW_CREATE_WORKSPACE = True
        mock_config.MAIL_TYPE = "smtp"
        mock_config.PLUGIN_MAX_PACKAGE_SIZE = 50

        from services.feature_service import FeatureService

        result = FeatureService.get_system_features()

        assert result.enable_acedatacloud_oauth_login is False
        assert result.enable_email_code_login is True
        assert result.enable_email_password_login is True
        assert result.enable_social_oauth_login is True
