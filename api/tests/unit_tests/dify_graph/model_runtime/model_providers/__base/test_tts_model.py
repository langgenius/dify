from unittest.mock import MagicMock

import pytest

from dify_graph.model_runtime.entities.common_entities import I18nObject
from dify_graph.model_runtime.entities.model_entities import ModelType
from dify_graph.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from dify_graph.model_runtime.errors.invoke import InvokeError
from dify_graph.model_runtime.model_providers.__base.tts_model import TTSModel


@pytest.fixture
def provider_schema() -> ProviderEntity:
    return ProviderEntity(
        provider="test_provider",
        label=I18nObject(en_US="test_provider"),
        supported_model_types=[ModelType.TTS],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
    )


@pytest.fixture
def model_runtime() -> MagicMock:
    return MagicMock()


@pytest.fixture
def tts_model(provider_schema: ProviderEntity, model_runtime: MagicMock) -> TTSModel:
    return TTSModel(provider_schema=provider_schema, model_runtime=model_runtime)


def test_model_type(tts_model: TTSModel) -> None:
    assert tts_model.model_type == ModelType.TTS


def test_invoke_success(tts_model: TTSModel, model_runtime: MagicMock) -> None:
    model_runtime.invoke_tts.return_value = [b"audio_chunk"]

    result = tts_model.invoke(
        model="test_model",
        credentials={"api_key": "abc"},
        content_text="Hello world",
        voice="alloy",
    )

    assert list(result) == [b"audio_chunk"]
    model_runtime.invoke_tts.assert_called_once_with(
        provider="test_provider",
        model="test_model",
        credentials={"api_key": "abc"},
        content_text="Hello world",
        voice="alloy",
    )


def test_invoke_exception(tts_model: TTSModel, model_runtime: MagicMock) -> None:
    model_runtime.invoke_tts.side_effect = Exception("Test error")

    with pytest.raises(InvokeError, match="Test error"):
        tts_model.invoke(
            model="test_model",
            credentials={"api_key": "abc"},
            content_text="Hello world",
            voice="alloy",
        )


def test_get_tts_model_voices(tts_model: TTSModel, model_runtime: MagicMock) -> None:
    model_runtime.get_tts_model_voices.return_value = [{"name": "Voice1"}]

    result = tts_model.get_tts_model_voices(
        model="test_model",
        credentials={"api_key": "abc"},
        language="en-US",
    )

    assert result == [{"name": "Voice1"}]
    model_runtime.get_tts_model_voices.assert_called_once_with(
        provider="test_provider",
        model="test_model",
        credentials={"api_key": "abc"},
        language="en-US",
    )
