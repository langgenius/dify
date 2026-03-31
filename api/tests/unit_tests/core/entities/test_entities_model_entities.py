"""Unit tests for model entity behavior and invariants.

Covers DefaultModelEntity, DefaultModelProviderEntity, ModelStatus,
ProviderModelWithStatusEntity, and SimpleModelProviderEntity. Assumes i18n
labels are provided via I18nObject, model metadata aligns with FetchFrom and
ModelType expectations, and ProviderEntity/ConfigurateMethod interactions
drive provider mapping behavior.
"""

import pytest
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import FetchFrom, ModelType
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity

from core.entities.model_entities import (
    DefaultModelEntity,
    DefaultModelProviderEntity,
    ModelStatus,
    ProviderModelWithStatusEntity,
    SimpleModelProviderEntity,
)


def _build_model_with_status(status: ModelStatus) -> ProviderModelWithStatusEntity:
    return ProviderModelWithStatusEntity(
        model="gpt-4",
        label=I18nObject(en_US="GPT-4"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={},
        status=status,
    )


def test_simple_model_provider_entity_maps_from_provider_entity() -> None:
    # Arrange
    provider_entity = ProviderEntity(
        provider="openai",
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
    )

    # Act
    simple_provider = SimpleModelProviderEntity(provider_entity)

    # Assert
    assert simple_provider.provider == "openai"
    assert simple_provider.label.en_US == "OpenAI"
    assert simple_provider.supported_model_types == [ModelType.LLM]


def test_provider_model_with_status_raises_for_known_error_statuses() -> None:
    # Arrange
    expectations = {
        ModelStatus.NO_CONFIGURE: "Model is not configured",
        ModelStatus.QUOTA_EXCEEDED: "Model quota has been exceeded",
        ModelStatus.NO_PERMISSION: "No permission to use this model",
        ModelStatus.DISABLED: "Model is disabled",
    }

    for status, message in expectations.items():
        # Act / Assert
        with pytest.raises(ValueError, match=message):
            _build_model_with_status(status).raise_for_status()


def test_provider_model_with_status_allows_active_and_credential_removed() -> None:
    # Arrange
    active_model = _build_model_with_status(ModelStatus.ACTIVE)
    removed_model = _build_model_with_status(ModelStatus.CREDENTIAL_REMOVED)

    # Act / Assert
    active_model.raise_for_status()
    removed_model.raise_for_status()


def test_default_model_entity_accepts_model_field_name() -> None:
    # Arrange / Act
    default_model = DefaultModelEntity(
        model="gpt-4o-mini",
        model_type=ModelType.LLM,
        provider=DefaultModelProviderEntity(
            provider="openai",
            label=I18nObject(en_US="OpenAI"),
            supported_model_types=[ModelType.LLM],
        ),
    )

    # Assert
    assert default_model.model == "gpt-4o-mini"
    assert default_model.provider.provider == "openai"
