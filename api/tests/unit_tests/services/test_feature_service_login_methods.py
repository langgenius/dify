from unittest.mock import patch

from services.feature_service import FeatureService


class TestFeatureServiceLoginMethods:
    def test_should_enforce_acedatacloud_auth_only(self) -> None:
        with patch("services.feature_service.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = False
            mock_config.MARKETPLACE_ENABLED = False
            mock_config.ENABLE_EMAIL_CODE_LOGIN = True
            mock_config.ENABLE_EMAIL_PASSWORD_LOGIN = True
            mock_config.ENABLE_SOCIAL_OAUTH_LOGIN = True
            mock_config.ALLOW_REGISTER = True
            mock_config.ALLOW_CREATE_WORKSPACE = True
            mock_config.MAIL_TYPE = "smtp"
            mock_config.ACEDATACLOUD_AUTH_BASE_URL = "https://auth.example.com"
            mock_config.ENABLE_ACEDATACLOUD_OAUTH_LOGIN = True

            system_features = FeatureService.get_system_features()

        assert system_features.enable_acedatacloud_oauth_login is True
        assert system_features.enable_email_code_login is False
        assert system_features.enable_email_password_login is False
        assert system_features.enable_social_oauth_login is False
        assert system_features.is_allow_register is False
        assert system_features.sso_enforced_for_signin is False
        assert system_features.sso_enforced_for_signin_protocol == ""
