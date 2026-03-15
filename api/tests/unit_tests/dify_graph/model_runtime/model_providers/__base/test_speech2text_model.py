from io import BytesIO
from unittest.mock import MagicMock

import pytest

from dify_graph.model_runtime.entities.common_entities import I18nObject
from dify_graph.model_runtime.entities.model_entities import ModelType
from dify_graph.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from dify_graph.model_runtime.errors.invoke import InvokeError
from dify_graph.model_runtime.model_providers.__base.speech2text_model import Speech2TextModel


@pytest.fixture
def provider_schema() -> ProviderEntity:
    return ProviderEntity(
        provider="test_provider",
        label=I18nObject(en_US="test_provider"),
        supported_model_types=[ModelType.SPEECH2TEXT],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
    )


@pytest.fixture
def model_runtime() -> MagicMock:
    return MagicMock()


@pytest.fixture
def speech2text_model(provider_schema: ProviderEntity, model_runtime: MagicMock) -> Speech2TextModel:
    return Speech2TextModel(provider_schema=provider_schema, model_runtime=model_runtime)


def test_model_type(speech2text_model: Speech2TextModel) -> None:
    assert speech2text_model.model_type == ModelType.SPEECH2TEXT


def test_invoke_success(speech2text_model: Speech2TextModel, model_runtime: MagicMock) -> None:
    file = BytesIO(b"audio data")
    model_runtime.invoke_speech_to_text.return_value = "transcribed text"

    result = speech2text_model.invoke(model="test_model", credentials={"api_key": "abc"}, file=file)

    assert result == "transcribed text"
    model_runtime.invoke_speech_to_text.assert_called_once_with(
        provider="test_provider",
        model="test_model",
        credentials={"api_key": "abc"},
        file=file,
    )


def test_invoke_exception(speech2text_model: Speech2TextModel, model_runtime: MagicMock) -> None:
    model_runtime.invoke_speech_to_text.side_effect = Exception("Test error")

    with pytest.raises(InvokeError, match="Test error"):
        speech2text_model.invoke(model="test_model", credentials={"api_key": "abc"}, file=BytesIO(b"audio data"))
