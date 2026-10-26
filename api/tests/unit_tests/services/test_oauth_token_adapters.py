from datetime import timedelta

import pytest

from configs import dify_config
from services.oauth_token_adapters import DifyConfigOAuthTokenSettings


def test_settings_read_dify_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dify_config, "ENABLE_OAUTH_AUTHORIZATION_CODE", False)
    monkeypatch.setattr(dify_config, "OAUTH_AUTH_CODE_ACCESS_TOKEN_TTL_HOURS", 5)
    monkeypatch.setattr(dify_config, "OAUTH_AUTHORIZATION_CODE_TTL_SECONDS", 90)
    settings = DifyConfigOAuthTokenSettings()

    assert settings.authorization_code_enabled is False
    assert settings.auth_code_access_token_lifetime == timedelta(hours=5)
    assert settings.authorization_code_ttl == timedelta(seconds=90)
