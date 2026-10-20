import pytest
from pydantic import ValidationError

from configs.feature import FeatureConfig


@pytest.mark.parametrize("field", ["APP_API_KEY_MAX_KEYS_PER_APP", "DATASET_API_KEY_MAX_KEYS_PER_WORKSPACE"])
def test_api_key_config_defaults_and_env(monkeypatch: pytest.MonkeyPatch, field: str) -> None:
    monkeypatch.delenv(field, raising=False)
    assert FeatureConfig().model_dump()[field] == 10
    monkeypatch.setenv(field, "1000")
    assert FeatureConfig().model_dump()[field] == 1000
    monkeypatch.setenv(field, "3")
    assert FeatureConfig().model_dump()[field] == 3


@pytest.mark.parametrize("field", ["APP_API_KEY_MAX_KEYS_PER_APP", "DATASET_API_KEY_MAX_KEYS_PER_WORKSPACE"])
@pytest.mark.parametrize("value", ["0", "-1", "invalid", "1.5"])
def test_rejects_invalid_api_key_limit(monkeypatch: pytest.MonkeyPatch, field: str, value: str) -> None:
    monkeypatch.setenv(field, value)
    with pytest.raises(ValidationError):
        FeatureConfig()
