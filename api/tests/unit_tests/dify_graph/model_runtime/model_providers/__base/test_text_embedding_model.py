from unittest.mock import MagicMock, patch

import pytest

from core.entities.embedding_type import EmbeddingInputType
from core.plugin.entities.plugin_daemon import PluginModelProviderEntity
from dify_graph.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from dify_graph.model_runtime.entities.text_embedding_entities import EmbeddingResult
from dify_graph.model_runtime.errors.invoke import InvokeError
from dify_graph.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel


class TestTextEmbeddingModel:
    @pytest.fixture
    def mock_plugin_model_provider(self):
        return MagicMock(spec=PluginModelProviderEntity)

    @pytest.fixture
    def text_embedding_model(self, mock_plugin_model_provider):
        return TextEmbeddingModel(
            tenant_id="tenant_123",
            model_type=ModelType.TEXT_EMBEDDING,
            plugin_id="plugin_123",
            provider_name="test_provider",
            plugin_model_provider=mock_plugin_model_provider,
        )

    def test_model_type(self, text_embedding_model):
        assert text_embedding_model.model_type == ModelType.TEXT_EMBEDDING

    def test_invoke_with_texts(self, text_embedding_model):
        model_name = "test_model"
        credentials = {"api_key": "abc"}
        texts = ["hello", "world"]
        user = "user_123"
        expected_result = MagicMock(spec=EmbeddingResult)

        with patch("core.plugin.impl.model.PluginModelClient") as mock_client_class:
            mock_client = mock_client_class.return_value
            mock_client.invoke_text_embedding.return_value = expected_result

            result = text_embedding_model.invoke(model=model_name, credentials=credentials, texts=texts, user=user)

            assert result == expected_result
            mock_client.invoke_text_embedding.assert_called_once_with(
                tenant_id="tenant_123",
                user_id="user_123",
                plugin_id="plugin_123",
                provider="test_provider",
                model=model_name,
                credentials=credentials,
                texts=texts,
                input_type=EmbeddingInputType.DOCUMENT,
            )

    def test_invoke_with_multimodel_documents(self, text_embedding_model):
        model_name = "test_model"
        credentials = {"api_key": "abc"}
        multimodel_documents = [{"type": "text", "text": "hello"}]
        expected_result = MagicMock(spec=EmbeddingResult)

        with patch("core.plugin.impl.model.PluginModelClient") as mock_client_class:
            mock_client = mock_client_class.return_value
            mock_client.invoke_multimodal_embedding.return_value = expected_result

            result = text_embedding_model.invoke(
                model=model_name, credentials=credentials, multimodel_documents=multimodel_documents
            )

            assert result == expected_result
            mock_client.invoke_multimodal_embedding.assert_called_once_with(
                tenant_id="tenant_123",
                user_id="unknown",
                plugin_id="plugin_123",
                provider="test_provider",
                model=model_name,
                credentials=credentials,
                documents=multimodel_documents,
                input_type=EmbeddingInputType.DOCUMENT,
            )

    def test_invoke_no_input(self, text_embedding_model):
        model_name = "test_model"
        credentials = {"api_key": "abc"}

        with pytest.raises(ValueError) as excinfo:
            text_embedding_model.invoke(model=model_name, credentials=credentials)

        assert "No texts or files provided" in str(excinfo.value)

    def test_invoke_precedence(self, text_embedding_model):
        model_name = "test_model"
        credentials = {"api_key": "abc"}
        texts = ["hello"]
        multimodel_documents = [{"type": "text", "text": "world"}]
        expected_result = MagicMock(spec=EmbeddingResult)

        with patch("core.plugin.impl.model.PluginModelClient") as mock_client_class:
            mock_client = mock_client_class.return_value
            mock_client.invoke_text_embedding.return_value = expected_result

            result = text_embedding_model.invoke(
                model=model_name, credentials=credentials, texts=texts, multimodel_documents=multimodel_documents
            )

            assert result == expected_result
            mock_client.invoke_text_embedding.assert_called_once()
            mock_client.invoke_multimodal_embedding.assert_not_called()

    def test_invoke_exception(self, text_embedding_model):
        model_name = "test_model"
        credentials = {"api_key": "abc"}
        texts = ["hello"]

        with patch("core.plugin.impl.model.PluginModelClient") as mock_client_class:
            mock_client = mock_client_class.return_value
            mock_client.invoke_text_embedding.side_effect = Exception("Test error")

            with pytest.raises(InvokeError) as excinfo:
                text_embedding_model.invoke(model=model_name, credentials=credentials, texts=texts)

            assert "[test_provider] Error: Test error" in str(excinfo.value.description)

    def test_get_num_tokens(self, text_embedding_model):
        model_name = "test_model"
        credentials = {"api_key": "abc"}
        texts = ["hello", "world"]
        expected_tokens = [1, 1]

        with patch("core.plugin.impl.model.PluginModelClient") as mock_client_class:
            mock_client = mock_client_class.return_value
            mock_client.get_text_embedding_num_tokens.return_value = expected_tokens

            result = text_embedding_model.get_num_tokens(model=model_name, credentials=credentials, texts=texts)

            assert result == expected_tokens
            mock_client.get_text_embedding_num_tokens.assert_called_once_with(
                tenant_id="tenant_123",
                user_id="unknown",
                plugin_id="plugin_123",
                provider="test_provider",
                model=model_name,
                credentials=credentials,
                texts=texts,
            )

    def test_get_context_size(self, text_embedding_model):
        model_name = "test_model"
        credentials = {"api_key": "abc"}

        # Test case 1: Context size in schema
        mock_schema = MagicMock()
        mock_schema.model_properties = {ModelPropertyKey.CONTEXT_SIZE: 2048}

        with patch.object(TextEmbeddingModel, "get_model_schema", return_value=mock_schema):
            assert text_embedding_model._get_context_size(model_name, credentials) == 2048

        # Test case 2: No schema
        with patch.object(TextEmbeddingModel, "get_model_schema", return_value=None):
            assert text_embedding_model._get_context_size(model_name, credentials) == 1000

        # Test case 3: Context size NOT in schema properties
        mock_schema.model_properties = {}
        with patch.object(TextEmbeddingModel, "get_model_schema", return_value=mock_schema):
            assert text_embedding_model._get_context_size(model_name, credentials) == 1000

    def test_get_max_chunks(self, text_embedding_model):
        model_name = "test_model"
        credentials = {"api_key": "abc"}

        # Test case 1: Max chunks in schema
        mock_schema = MagicMock()
        mock_schema.model_properties = {ModelPropertyKey.MAX_CHUNKS: 10}

        with patch.object(TextEmbeddingModel, "get_model_schema", return_value=mock_schema):
            assert text_embedding_model._get_max_chunks(model_name, credentials) == 10

        # Test case 2: No schema
        with patch.object(TextEmbeddingModel, "get_model_schema", return_value=None):
            assert text_embedding_model._get_max_chunks(model_name, credentials) == 1

        # Test case 3: Max chunks NOT in schema properties
        mock_schema.model_properties = {}
        with patch.object(TextEmbeddingModel, "get_model_schema", return_value=mock_schema):
            assert text_embedding_model._get_max_chunks(model_name, credentials) == 1
