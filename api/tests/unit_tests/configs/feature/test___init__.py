from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest
from pydantic import ValidationError

import configs.feature as feature_config
from configs.feature import AuthConfig, FileUploadConfig, LoggingConfig
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


class _IsolatedFileUploadConfig(InitSettingsOnly, FileUploadConfig):
    pass


class _IsolatedLoggingConfig(InitSettingsOnly, LoggingConfig):
    pass


@pytest.mark.parametrize(
    ("configured", "expected"),
    [
        (None, None),
        ("", ""),
        ("UTC", "UTC"),
        ("Asia/Shanghai", "Asia/Shanghai"),
        ("US/Eastern", "US/Eastern"),
    ],
)
def test_log_timezone_preserves_unset_and_directly_valid_values(configured: str | None, expected: str | None) -> None:
    config = _IsolatedLoggingConfig(LOG_TZ=configured)

    assert expected == config.LOG_TZ


def test_log_timezone_defaults_to_utc() -> None:
    config = _IsolatedLoggingConfig()

    assert config.LOG_TZ == "UTC"


def test_log_timezone_does_not_build_casefold_index_for_direct_match(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_if_called() -> dict[str, str]:
        pytest.fail("direct ZoneInfo matches must not scan all available timezone names")

    monkeypatch.setattr(feature_config, "_timezone_names_by_casefold", fail_if_called)

    config = _IsolatedLoggingConfig(LOG_TZ="UTC")

    assert config.LOG_TZ == "UTC"


@pytest.mark.parametrize(
    ("configured", "iana_name"),
    [
        ("utc", "UTC"),
        ("asia/shanghai", "Asia/Shanghai"),
        ("europe/dublin", "Europe/Dublin"),
    ],
)
def test_log_timezone_accepts_case_insensitive_names_with_equivalent_offsets(configured: str, iana_name: str) -> None:
    config = _IsolatedLoggingConfig(LOG_TZ=configured)

    assert config.LOG_TZ is not None
    assert config.LOG_TZ.casefold() == iana_name.casefold()

    configured_timezone = ZoneInfo(config.LOG_TZ)
    expected_timezone = ZoneInfo(iana_name)
    for instant in (
        datetime(2026, 1, 15, 12, tzinfo=UTC),
        datetime(2026, 7, 15, 12, tzinfo=UTC),
    ):
        assert instant.astimezone(configured_timezone).utcoffset() == instant.astimezone(expected_timezone).utcoffset()


@pytest.mark.parametrize("configured", ["Not/AZone", "America", "A/../B\nINJECTED"])
def test_log_timezone_rejects_unknown_or_malformed_values(configured: str) -> None:
    with pytest.raises(ValidationError) as exc_info:
        _IsolatedLoggingConfig(LOG_TZ=configured)

    assert repr(configured) in str(exc_info.value)


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
