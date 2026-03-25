from unittest.mock import MagicMock, patch

import pytest

from dify_graph.model_runtime.entities.common_entities import I18nObject
from dify_graph.model_runtime.entities.model_entities import ModelType
from dify_graph.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from dify_graph.model_runtime.errors.invoke import InvokeError
from dify_graph.model_runtime.model_providers.__base.moderation_model import ModerationModel


@pytest.fixture
def provider_schema() -> ProviderEntity:
    return ProviderEntity(
        provider="test_provider",
        label=I18nObject(en_US="test_provider"),
        supported_model_types=[ModelType.MODERATION],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
    )


@pytest.fixture
def model_runtime() -> MagicMock:
    return MagicMock()


@pytest.fixture
def moderation_model(provider_schema: ProviderEntity, model_runtime: MagicMock) -> ModerationModel:
    return ModerationModel(provider_schema=provider_schema, model_runtime=model_runtime)


def test_model_type(moderation_model: ModerationModel) -> None:
    assert moderation_model.model_type == ModelType.MODERATION


def test_invoke_success(moderation_model: ModerationModel, model_runtime: MagicMock) -> None:
    with patch("time.perf_counter", return_value=1.0):
        model_runtime.invoke_moderation.return_value = True

        result = moderation_model.invoke(model="test_model", credentials={"api_key": "abc"}, text="test text")

    assert result is True
    assert moderation_model.started_at == 1.0
    model_runtime.invoke_moderation.assert_called_once_with(
        provider="test_provider",
        model="test_model",
        credentials={"api_key": "abc"},
        text="test text",
    )


def test_invoke_exception(moderation_model: ModerationModel, model_runtime: MagicMock) -> None:
    model_runtime.invoke_moderation.side_effect = Exception("Test error")

    with pytest.raises(InvokeError, match="Test error"):
        moderation_model.invoke(model="test_model", credentials={"api_key": "abc"}, text="test text")
