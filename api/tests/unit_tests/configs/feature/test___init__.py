import pytest
from pydantic import ValidationError

from configs.feature import AuthConfig, DataSetConfig, FileUploadConfig
from tests.helpers.unit.configs._isolated_settings import InitSettingsOnly


class _IsolatedAuthConfig(InitSettingsOnly, AuthConfig):
    pass


class _IsolatedDataSetConfig(InitSettingsOnly, DataSetConfig):
    pass


def test_dataset_description_max_length_defaults_to_400() -> None:
    assert _IsolatedDataSetConfig().DATASET_DESCRIPTION_MAX_LENGTH == 400


@pytest.mark.parametrize("limit", [100, 2000])
def test_dataset_description_max_length_reads_environment(monkeypatch: pytest.MonkeyPatch, limit: int) -> None:
    monkeypatch.setenv("DATASET_DESCRIPTION_MAX_LENGTH", str(limit))

    config = DataSetConfig(_env_file=None)
    assert limit == config.DATASET_DESCRIPTION_MAX_LENGTH


@pytest.mark.parametrize("limit", ["0", "-1", "invalid"])
def test_dataset_description_max_length_rejects_invalid_environment(
    monkeypatch: pytest.MonkeyPatch, limit: str
) -> None:
    monkeypatch.setenv("DATASET_DESCRIPTION_MAX_LENGTH", limit)

    with pytest.raises(ValidationError, match="DATASET_DESCRIPTION_MAX_LENGTH"):
        DataSetConfig(_env_file=None)


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
