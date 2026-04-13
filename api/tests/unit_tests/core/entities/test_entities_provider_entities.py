import pytest
from graphon.model_runtime.entities.model_entities import ModelType

from core.entities.parameter_entities import AppSelectorScope
from core.entities.provider_entities import (
    BasicProviderConfig,
    ModelSettings,
    ProviderConfig,
    ProviderQuotaType,
)
from core.tools.entities.common_entities import I18nObject


def test_provider_quota_type_value_of_returns_enum_member() -> None:
    # Arrange / Act
    quota_type = ProviderQuotaType.value_of(ProviderQuotaType.TRIAL.value)

    # Assert
    assert quota_type == ProviderQuotaType.TRIAL


def test_provider_quota_type_value_of_rejects_unknown_values() -> None:
    # Arrange / Act / Assert
    with pytest.raises(ValueError, match="No matching enum found"):
        ProviderQuotaType.value_of("enterprise")


def test_basic_provider_config_type_value_of_handles_known_values() -> None:
    # Arrange / Act
    parameter_type = BasicProviderConfig.Type.value_of("text-input")

    # Assert
    assert parameter_type == BasicProviderConfig.Type.TEXT_INPUT


def test_basic_provider_config_type_value_of_rejects_invalid_values() -> None:
    # Arrange / Act / Assert
    with pytest.raises(ValueError, match="invalid mode value"):
        BasicProviderConfig.Type.value_of("unknown")


def test_provider_config_to_basic_provider_config_keeps_type_and_name() -> None:
    # Arrange
    provider_config = ProviderConfig(
        type=BasicProviderConfig.Type.SELECT,
        name="workspace",
        scope=AppSelectorScope.ALL,
        options=[ProviderConfig.Option(value="all", label=I18nObject(en_US="All"))],
    )

    # Act
    basic_config = provider_config.to_basic_provider_config()

    # Assert
    assert isinstance(basic_config, BasicProviderConfig)
    assert basic_config.type == BasicProviderConfig.Type.SELECT
    assert basic_config.name == "workspace"


def test_model_settings_accepts_model_field_name() -> None:
    # Arrange / Act
    settings = ModelSettings(
        model="gpt-4o",
        model_type=ModelType.LLM,
        enabled=True,
        load_balancing_enabled=False,
        load_balancing_configs=[],
    )

    # Assert
    assert settings.model == "gpt-4o"
    assert settings.model_type == ModelType.LLM
