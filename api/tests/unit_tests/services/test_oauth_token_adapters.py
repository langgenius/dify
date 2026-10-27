from collections.abc import Callable
from datetime import timedelta

import pytest

from configs import dify_config
from services.oauth_token_adapters import (
    DifyConfigOAuthTokenSettings,
    authorization_code_enabled,
    cimd_enabled,
    dcr_enabled,
    discovery_enabled,
)


def test_settings_read_dify_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dify_config, "ENABLE_OAUTH_AUTHORIZATION_CODE", False)
    monkeypatch.setattr(dify_config, "OAUTH_AUTH_CODE_ACCESS_TOKEN_TTL_HOURS", 5)
    monkeypatch.setattr(dify_config, "OAUTH_AUTHORIZATION_CODE_TTL_SECONDS", 90)
    monkeypatch.setattr(dify_config, "OAUTH_REFRESH_TOKEN_TTL_DAYS", 7)
    monkeypatch.setattr(dify_config, "OAUTH_REFRESH_TOKEN_REUSE_GRACE_MINUTES", 0)
    settings = DifyConfigOAuthTokenSettings()

    assert settings.authorization_code_enabled is False
    assert settings.auth_code_access_token_lifetime == timedelta(hours=5)
    assert settings.authorization_code_ttl == timedelta(seconds=90)
    assert settings.refresh_token_lifetime == timedelta(days=7)
    assert settings.refresh_reuse_grace == timedelta()


# The browser flow needs bearer auth: without it no token it issues could be used.
@pytest.mark.parametrize(
    ("bearer", "authorization_code", "expected"),
    [(True, True, True), (True, False, False), (False, True, False), (False, False, False)],
)
def test_authorization_code_needs_bearer(
    monkeypatch: pytest.MonkeyPatch, bearer: bool, authorization_code: bool, expected: bool
) -> None:
    monkeypatch.setattr(dify_config, "ENABLE_OAUTH_BEARER", bearer)
    monkeypatch.setattr(dify_config, "ENABLE_OAUTH_AUTHORIZATION_CODE", authorization_code)

    assert authorization_code_enabled() is expected
    assert DifyConfigOAuthTokenSettings().authorization_code_enabled is expected


@pytest.mark.parametrize("enabled", [dcr_enabled, cimd_enabled], ids=["dcr", "cimd"])
@pytest.mark.parametrize(
    ("bearer", "authorization_code", "own_flag", "expected"),
    [
        (True, True, True, True),
        (True, True, False, False),
        (True, False, True, False),
        (False, True, True, False),
    ],
)
def test_self_registration_needs_the_browser_flow(
    monkeypatch: pytest.MonkeyPatch,
    enabled: Callable[[], bool],
    bearer: bool,
    authorization_code: bool,
    own_flag: bool,
    expected: bool,
) -> None:
    monkeypatch.setattr(dify_config, "ENABLE_OAUTH_BEARER", bearer)
    monkeypatch.setattr(dify_config, "ENABLE_OAUTH_AUTHORIZATION_CODE", authorization_code)
    monkeypatch.setattr(dify_config, "ENABLE_OAUTH_DCR", own_flag)
    monkeypatch.setattr(dify_config, "ENABLE_OAUTH_CIMD", own_flag)

    assert enabled() is expected


# Without CONSOLE_API_URL the issuer would come from the request host, often an internal http:// one.
@pytest.mark.parametrize(
    ("bearer", "console_api_url", "expected"),
    [
        (True, "https://api.example.com", True),
        (True, "", False),
        (False, "https://api.example.com", False),
        (False, "", False),
    ],
)
def test_discovery_needs_bearer_and_console_api_url(
    monkeypatch: pytest.MonkeyPatch, bearer: bool, console_api_url: str, expected: bool
) -> None:
    monkeypatch.setattr(dify_config, "ENABLE_OAUTH_BEARER", bearer)
    monkeypatch.setattr(dify_config, "CONSOLE_API_URL", console_api_url)

    assert discovery_enabled() is expected
