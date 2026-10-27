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
    assert config.OAUTH_REFRESH_TOKEN_TTL_DAYS == 30
    assert config.OAUTH_REFRESH_TOKEN_REUSE_GRACE_MINUTES == 30


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


@pytest.mark.parametrize(
    ("configured", "expected"),
    [("7", 7), ("1", 1), ("365", 365), ("0", 1), ("-5", 1), ("1000", 365), ("abc", 30), ("", 30)],
)
def test_oauth_refresh_token_ttl_days_clamps_or_falls_back(configured: str, expected: int) -> None:
    config = _IsolatedAuthConfig(OAUTH_REFRESH_TOKEN_TTL_DAYS=configured)

    assert expected == config.OAUTH_REFRESH_TOKEN_TTL_DAYS


@pytest.mark.parametrize(
    ("configured", "expected"),
    [("5", 5), ("0", 0), ("1440", 1440), ("-5", 0), ("2000", 1440), ("abc", 30), ("", 30)],
)
def test_oauth_refresh_token_reuse_grace_minutes_clamps_or_falls_back(configured: str, expected: int) -> None:
    config = _IsolatedAuthConfig(OAUTH_REFRESH_TOKEN_REUSE_GRACE_MINUTES=configured)

    assert expected == config.OAUTH_REFRESH_TOKEN_REUSE_GRACE_MINUTES


def test_unused_oauth_client_cleanup_settings_default() -> None:
    config = _IsolatedAuthConfig()

    assert config.OAUTH_UNUSED_DCR_CLIENT_RETENTION_DAYS == 7


@pytest.mark.parametrize(
    ("configured", "expected"),
    [("14", 14), ("1", 1), ("365", 365), ("0", 1), ("-5", 1), ("1000", 365), ("abc", 7), ("", 7)],
)
def test_oauth_unused_dcr_client_retention_days_clamps_or_falls_back(configured: str, expected: int) -> None:
    config = _IsolatedAuthConfig(OAUTH_UNUSED_DCR_CLIENT_RETENTION_DAYS=configured)

    assert expected == config.OAUTH_UNUSED_DCR_CLIENT_RETENTION_DAYS


def test_oauth_cimd_fetch_limit_defaults_to_sixty_per_minute() -> None:
    config = _IsolatedAuthConfig()

    assert config.OAUTH_CIMD_FETCH_LIMIT_PER_MINUTE == 60


@pytest.mark.parametrize(
    ("configured", "expected"),
    [("100", 100), ("0", 0), ("10000", 10000), ("-5", 0), ("20000", 10000), ("abc", 60), ("", 60)],
)
def test_oauth_cimd_fetch_limit_clamps_or_falls_back(configured: str, expected: int) -> None:
    config = _IsolatedAuthConfig(OAUTH_CIMD_FETCH_LIMIT_PER_MINUTE=configured)

    assert expected == config.OAUTH_CIMD_FETCH_LIMIT_PER_MINUTE


def test_oauth_client_ip_rate_limits_default() -> None:
    config = _IsolatedAuthConfig()

    assert config.OAUTH_DCR_RATE_LIMIT_PER_HOUR == 120
    assert config.OAUTH_AUTHORIZE_CLIENT_RATE_LIMIT_PER_5_MIN == 300


@pytest.mark.parametrize("setting", ["OAUTH_DCR_RATE_LIMIT_PER_HOUR", "OAUTH_AUTHORIZE_CLIENT_RATE_LIMIT_PER_5_MIN"])
@pytest.mark.parametrize(
    ("configured", "expected"),
    [("500", 500), ("0", 0), ("10000", 10000), ("-5", 0), ("20000", 10000)],
)
def test_oauth_client_ip_rate_limits_clamp(setting: str, configured: str, expected: int) -> None:
    config = _IsolatedAuthConfig.model_validate({setting: configured})

    assert config.model_dump()[setting] == expected


@pytest.mark.parametrize(
    ("setting", "default"),
    [("OAUTH_DCR_RATE_LIMIT_PER_HOUR", 120), ("OAUTH_AUTHORIZE_CLIENT_RATE_LIMIT_PER_5_MIN", 300)],
)
@pytest.mark.parametrize("configured", ["abc", ""])
def test_oauth_client_ip_rate_limits_fall_back_to_the_default(setting: str, default: int, configured: str) -> None:
    config = _IsolatedAuthConfig.model_validate({setting: configured})

    assert config.model_dump()[setting] == default


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
