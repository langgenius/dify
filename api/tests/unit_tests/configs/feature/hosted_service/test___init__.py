import pytest
from pydantic import ValidationError

from configs.feature.hosted_service import HostedCreditConfig, HostedModerationConfig
from tests.helpers.unit.configs._isolated_settings import InitSettingsOnly


class _IsolatedHostedModerationConfig(InitSettingsOnly, HostedModerationConfig):
    pass


def test_hosted_batch_limits_preserve_defaults() -> None:
    config = _IsolatedHostedModerationConfig()
    assert config.HOSTED_MODERATION_BATCH_MAX_ITEMS == 32
    assert config.HOSTED_MODERATION_BATCH_MAX_TEXT_BYTES == 131072


def test_hosted_batch_limits_load_environment_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOSTED_MODERATION_BATCH_MAX_ITEMS", "12")
    monkeypatch.setenv("HOSTED_MODERATION_BATCH_MAX_TEXT_BYTES", "4096")

    config = HostedModerationConfig(_env_file=None)
    assert config.HOSTED_MODERATION_BATCH_MAX_ITEMS == 12
    assert config.HOSTED_MODERATION_BATCH_MAX_TEXT_BYTES == 4096


@pytest.mark.parametrize("name", ["HOSTED_MODERATION_BATCH_MAX_ITEMS", "HOSTED_MODERATION_BATCH_MAX_TEXT_BYTES"])
@pytest.mark.parametrize("value", ["0", "-1", "invalid"])
def test_hosted_batch_limits_reject_invalid_environment_values(
    monkeypatch: pytest.MonkeyPatch, name: str, value: str
) -> None:
    monkeypatch.setenv(name, value)
    with pytest.raises(ValidationError, match=name):
        HostedModerationConfig(_env_file=None)


def test_credit_rates_follow_the_current_price_table_without_changing_legacy_matches() -> None:
    prices = HostedCreditConfig(HOSTED_MODEL_CREDIT_CONFIG="free:0,paid:2,paid:5,paid :9,bad:n/a")

    assert [prices.get_model_credits(name) for name in ("free", "paid", "bad", "unknown")] == [0, 5, 1, 1]

    prices.HOSTED_MODEL_CREDIT_CONFIG = "free:3,paid:0"
    assert [prices.get_model_credits(name) for name in ("free", "paid")] == [3, 0]
