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


@pytest.mark.parametrize(
    ("setting", "configured", "expected"),
    [
        ("OAUTH_AUTH_CODE_ACCESS_TOKEN_TTL_HOURS", "999999", 8760),
        ("OAUTH_AUTH_CODE_ACCESS_TOKEN_TTL_HOURS", "", 1),
        ("OAUTH_AUTHORIZATION_CODE_TTL_SECONDS", "0", 60),
        ("OAUTH_AUTHORIZATION_CODE_TTL_SECONDS", "1000", 600),
        ("OAUTH_REFRESH_TOKEN_TTL_DAYS", "1000", 365),
        ("OAUTH_REFRESH_TOKEN_TTL_DAYS", "abc", 30),
        ("OAUTH_UNUSED_DCR_CLIENT_RETENTION_DAYS", "0", 1),
        ("OAUTH_UNUSED_DCR_CLIENT_RETENTION_DAYS", "abc", 7),
        ("OAUTH_CIMD_FETCH_LIMIT_PER_MINUTE", "0", 0),
        ("OAUTH_CIMD_FETCH_LIMIT_PER_MINUTE", "20000", 10000),
        ("OAUTH_DCR_RATE_LIMIT_PER_HOUR", "-5", 0),
        ("OAUTH_DCR_RATE_LIMIT_PER_HOUR", "abc", 120),
        ("OAUTH_AUTHORIZE_CLIENT_RATE_LIMIT_PER_5_MIN", "0", 0),
        ("OAUTH_AUTHORIZE_CLIENT_RATE_LIMIT_PER_5_MIN", "", 300),
    ],
)
def test_oauth_int_settings_clamp_or_fall_back_instead_of_failing(setting: str, configured: str, expected: int) -> None:
    config = _IsolatedAuthConfig.model_validate({setting: configured})

    assert config.model_dump()[setting] == expected


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
