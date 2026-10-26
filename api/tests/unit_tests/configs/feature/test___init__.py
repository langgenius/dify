import pytest

from configs.feature import AuthConfig, FileUploadConfig
from tests.helpers.unit.configs._isolated_settings import InitSettingsOnly


class _IsolatedAuthConfig(InitSettingsOnly, AuthConfig):
    pass


def test_oauth_ttl_days_defaults_to_fourteen() -> None:
    config = _IsolatedAuthConfig()

    assert config.OAUTH_TTL_DAYS == 14


@pytest.mark.parametrize(
    ("configured", "expected"),
    [("30", 30), ("1", 1), ("365", 365), ("0", 1), ("-5", 1), ("500", 365), ("invalid", 14), ("", 14)],
)
def test_oauth_ttl_days_clamps_or_falls_back_instead_of_failing(configured: str, expected: int) -> None:
    config = _IsolatedAuthConfig(OAUTH_TTL_DAYS=configured)

    assert expected == config.OAUTH_TTL_DAYS


def test_oauth_max_tokens_per_account_defaults_to_fifteen() -> None:
    config = _IsolatedAuthConfig()

    assert config.OAUTH_MAX_TOKENS_PER_ACCOUNT == 15


@pytest.mark.parametrize(
    ("configured", "expected"),
    [("30", 30), ("1", 1), ("100", 100), ("0", 1), ("-5", 1), ("500", 100), ("abc", 15), ("", 15)],
)
def test_oauth_max_tokens_per_account_clamps_or_falls_back_instead_of_failing(configured: str, expected: int) -> None:
    config = _IsolatedAuthConfig(OAUTH_MAX_TOKENS_PER_ACCOUNT=configured)

    assert expected == config.OAUTH_MAX_TOKENS_PER_ACCOUNT


def test_oauth_authorization_code_settings_default() -> None:
    config = _IsolatedAuthConfig()

    assert config.ENABLE_OAUTH_AUTHORIZATION_CODE is True
    assert config.OAUTH_AUTH_CODE_ACCESS_TOKEN_TTL_HOURS == 24
    assert config.OAUTH_AUTHORIZATION_CODE_TTL_SECONDS == 600


@pytest.mark.parametrize(
    ("configured", "expected"),
    [("48", 48), ("1", 1), ("8760", 8760), ("0", 1), ("-5", 1), ("999999", 8760), ("abc", 24), ("", 24)],
)
def test_oauth_auth_code_access_token_ttl_hours_clamps_or_falls_back(configured: str, expected: int) -> None:
    config = _IsolatedAuthConfig(OAUTH_AUTH_CODE_ACCESS_TOKEN_TTL_HOURS=configured)

    assert expected == config.OAUTH_AUTH_CODE_ACCESS_TOKEN_TTL_HOURS


@pytest.mark.parametrize(
    ("configured", "expected"),
    [("120", 120), ("60", 60), ("600", 600), ("0", 60), ("-5", 60), ("1000", 600), ("abc", 600), ("", 600)],
)
def test_oauth_authorization_code_ttl_seconds_clamps_or_falls_back(configured: str, expected: int) -> None:
    config = _IsolatedAuthConfig(OAUTH_AUTHORIZATION_CODE_TTL_SECONDS=configured)

    assert expected == config.OAUTH_AUTHORIZATION_CODE_TTL_SECONDS


class _IsolatedFileUploadConfig(InitSettingsOnly, FileUploadConfig):
    pass


def test_paid_plan_file_size_limit_uses_its_default() -> None:
    config = _IsolatedFileUploadConfig(UPLOAD_FILE_SIZE_LIMIT="23")

    assert config.UPLOAD_FILE_SIZE_LIMIT == 23
    assert config.KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN == 15


def test_paid_plan_file_size_limit_can_be_configured_separately() -> None:
    config = _IsolatedFileUploadConfig(
        UPLOAD_FILE_SIZE_LIMIT="23",
        KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN="50",
    )

    assert config.UPLOAD_FILE_SIZE_LIMIT == 23
    assert config.KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN == 50
