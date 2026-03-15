from unittest.mock import MagicMock, patch

import pytest

from dify_graph.model_runtime.entities.common_entities import I18nObject
from dify_graph.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from dify_graph.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from dify_graph.model_runtime.entities.text_embedding_entities import EmbeddingInputType, EmbeddingResult
from dify_graph.model_runtime.errors.invoke import InvokeError
from dify_graph.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel


@pytest.fixture
def provider_schema() -> ProviderEntity:
    return ProviderEntity(
        provider="test_provider",
        label=I18nObject(en_US="test_provider"),
        supported_model_types=[ModelType.TEXT_EMBEDDING],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
    )


@pytest.fixture
def model_runtime() -> MagicMock:
    return MagicMock()


@pytest.fixture
def text_embedding_model(provider_schema: ProviderEntity, model_runtime: MagicMock) -> TextEmbeddingModel:
    return TextEmbeddingModel(provider_schema=provider_schema, model_runtime=model_runtime)


def test_model_type(text_embedding_model: TextEmbeddingModel) -> None:
    assert text_embedding_model.model_type == ModelType.TEXT_EMBEDDING


def test_invoke_with_texts(text_embedding_model: TextEmbeddingModel, model_runtime: MagicMock) -> None:
    expected_result = MagicMock(spec=EmbeddingResult)
    model_runtime.invoke_text_embedding.return_value = expected_result

    result = text_embedding_model.invoke(model="test_model", credentials={"api_key": "abc"}, texts=["hello", "world"])

    assert result == expected_result
    model_runtime.invoke_text_embedding.assert_called_once_with(
        provider="test_provider",
        model="test_model",
        credentials={"api_key": "abc"},
        texts=["hello", "world"],
        input_type=EmbeddingInputType.DOCUMENT,
    )


def test_invoke_with_multimodal_documents(text_embedding_model: TextEmbeddingModel, model_runtime: MagicMock) -> None:
    expected_result = MagicMock(spec=EmbeddingResult)
    model_runtime.invoke_multimodal_embedding.return_value = expected_result

    result = text_embedding_model.invoke(
        model="test_model",
        credentials={"api_key": "abc"},
        multimodel_documents=[{"type": "text", "text": "hello"}],
    )

    assert result == expected_result
    model_runtime.invoke_multimodal_embedding.assert_called_once_with(
        provider="test_provider",
        model="test_model",
        credentials={"api_key": "abc"},
        documents=[{"type": "text", "text": "hello"}],
        input_type=EmbeddingInputType.DOCUMENT,
    )


def test_invoke_no_input(text_embedding_model: TextEmbeddingModel) -> None:
    with pytest.raises(ValueError, match="No texts or files provided"):
        text_embedding_model.invoke(model="test_model", credentials={"api_key": "abc"})


def test_invoke_prefers_texts_over_multimodal_documents(
    text_embedding_model: TextEmbeddingModel, model_runtime: MagicMock
) -> None:
    expected_result = MagicMock(spec=EmbeddingResult)
    model_runtime.invoke_text_embedding.return_value = expected_result

    result = text_embedding_model.invoke(
        model="test_model",
        credentials={"api_key": "abc"},
        texts=["hello"],
        multimodel_documents=[{"type": "text", "text": "world"}],
    )

    assert result == expected_result
    model_runtime.invoke_text_embedding.assert_called_once()
    model_runtime.invoke_multimodal_embedding.assert_not_called()


def test_invoke_exception(text_embedding_model: TextEmbeddingModel, model_runtime: MagicMock) -> None:
    model_runtime.invoke_text_embedding.side_effect = Exception("Test error")

    with pytest.raises(InvokeError, match="Test error"):
        text_embedding_model.invoke(model="test_model", credentials={"api_key": "abc"}, texts=["hello"])


def test_get_num_tokens(text_embedding_model: TextEmbeddingModel, model_runtime: MagicMock) -> None:
    model_runtime.get_text_embedding_num_tokens.return_value = [1, 1]

    result = text_embedding_model.get_num_tokens(
        model="test_model", credentials={"api_key": "abc"}, texts=["hello", "world"]
    )

    assert result == [1, 1]
    model_runtime.get_text_embedding_num_tokens.assert_called_once_with(
        provider="test_provider",
        model="test_model",
        credentials={"api_key": "abc"},
        texts=["hello", "world"],
    )


def test_get_context_size(text_embedding_model: TextEmbeddingModel) -> None:
    mock_schema = MagicMock()
    mock_schema.model_properties = {ModelPropertyKey.CONTEXT_SIZE: 2048}

    with patch.object(TextEmbeddingModel, "get_model_schema", return_value=mock_schema):
        assert text_embedding_model._get_context_size("test_model", {"api_key": "abc"}) == 2048

    with patch.object(TextEmbeddingModel, "get_model_schema", return_value=None):
        assert text_embedding_model._get_context_size("test_model", {"api_key": "abc"}) == 1000

    mock_schema.model_properties = {}
    with patch.object(TextEmbeddingModel, "get_model_schema", return_value=mock_schema):
        assert text_embedding_model._get_context_size("test_model", {"api_key": "abc"}) == 1000


def test_get_max_chunks(text_embedding_model: TextEmbeddingModel) -> None:
    mock_schema = MagicMock()
    mock_schema.model_properties = {ModelPropertyKey.MAX_CHUNKS: 10}

    with patch.object(TextEmbeddingModel, "get_model_schema", return_value=mock_schema):
        assert text_embedding_model._get_max_chunks("test_model", {"api_key": "abc"}) == 10

    with patch.object(TextEmbeddingModel, "get_model_schema", return_value=None):
        assert text_embedding_model._get_max_chunks("test_model", {"api_key": "abc"}) == 1

    mock_schema.model_properties = {}
    with patch.object(TextEmbeddingModel, "get_model_schema", return_value=mock_schema):
        assert text_embedding_model._get_max_chunks("test_model", {"api_key": "abc"}) == 1
