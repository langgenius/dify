"""Unit tests for cached_embedding.py - CacheEmbedding class.

This test file covers the methods not fully tested in test_embedding_service.py:
- embed_multimodal_documents
- embed_multimodal_query
- Error handling scenarios in embed_query (DEBUG mode)
"""

import base64
from decimal import Decimal
from unittest.mock import Mock, patch

import numpy as np
import pytest
from graphon.model_runtime.entities.model_entities import ModelPropertyKey
from graphon.model_runtime.entities.text_embedding_entities import EmbeddingResult, EmbeddingUsage
from sqlalchemy.exc import IntegrityError

from core.rag.embedding.cached_embedding import CacheEmbedding
from models.dataset import Embedding


class TestCacheEmbeddingMultimodalDocuments:
    """Test suite for CacheEmbedding.embed_multimodal_documents method."""

    @pytest.fixture
    def mock_model_instance(self):
        """Create a mock ModelInstance for testing."""
        model_instance = Mock()
        model_instance.model = "vision-embedding-model"
        model_instance.model_name = "vision-embedding-model"
        model_instance.provider = "openai"
        model_instance.credentials = {"api_key": "test-key"}

        model_type_instance = Mock()
        model_instance.model_type_instance = model_type_instance

        model_schema = Mock()
        model_schema.model_properties = {ModelPropertyKey.MAX_CHUNKS: 10}
        model_type_instance.get_model_schema.return_value = model_schema

        return model_instance

    @pytest.fixture
    def sample_multimodal_result(self):
        """Create a sample multimodal EmbeddingResult."""
        embedding_vector = np.random.randn(1536)
        normalized_vector = (embedding_vector / np.linalg.norm(embedding_vector)).tolist()

        usage = EmbeddingUsage(
            tokens=10,
            total_tokens=10,
            unit_price=Decimal("0.0001"),
            price_unit=Decimal(1000),
            total_price=Decimal("0.000001"),
            currency="USD",
            latency=0.5,
        )

        return EmbeddingResult(
            model="vision-embedding-model",
            embeddings=[normalized_vector],
            usage=usage,
        )

    def test_embed_single_multimodal_document_cache_miss(self, mock_model_instance, sample_multimodal_result):
        """Test embedding a single multimodal document when cache is empty."""
        cache_embedding = CacheEmbedding(mock_model_instance)
        documents = [{"file_id": "file123", "content": "test content"}]

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.scalar.return_value = None
            mock_model_instance.invoke_multimodal_embedding.return_value = sample_multimodal_result

            result = cache_embedding.embed_multimodal_documents(documents)

            assert len(result) == 1
            assert isinstance(result[0], list)
            assert len(result[0]) == 1536

            mock_model_instance.invoke_multimodal_embedding.assert_called_once()
            mock_session.add.assert_called_once()
            mock_session.commit.assert_called_once()

    def test_embed_multiple_multimodal_documents_cache_miss(self, mock_model_instance):
        """Test embedding multiple multimodal documents when cache is empty."""
        cache_embedding = CacheEmbedding(mock_model_instance)
        documents = [
            {"file_id": "file1", "content": "content 1"},
            {"file_id": "file2", "content": "content 2"},
            {"file_id": "file3", "content": "content 3"},
        ]

        embeddings = []
        for _ in range(3):
            vector = np.random.randn(1536)
            normalized = (vector / np.linalg.norm(vector)).tolist()
            embeddings.append(normalized)

        usage = EmbeddingUsage(
            tokens=30,
            total_tokens=30,
            unit_price=Decimal("0.0001"),
            price_unit=Decimal(1000),
            total_price=Decimal("0.000003"),
            currency="USD",
            latency=0.8,
        )

        embedding_result = EmbeddingResult(
            model="vision-embedding-model",
            embeddings=embeddings,
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.scalar.return_value = None
            mock_model_instance.invoke_multimodal_embedding.return_value = embedding_result

            result = cache_embedding.embed_multimodal_documents(documents)

            assert len(result) == 3
            assert all(len(emb) == 1536 for emb in result)

    def test_embed_multimodal_documents_cache_hit(self, mock_model_instance):
        """Test embedding multimodal documents when embeddings are cached."""
        cache_embedding = CacheEmbedding(mock_model_instance)
        documents = [{"file_id": "file123"}]

        cached_vector = np.random.randn(1536)
        normalized_cached = (cached_vector / np.linalg.norm(cached_vector)).tolist()

        mock_cached_embedding = Mock(spec=Embedding)
        mock_cached_embedding.get_embedding.return_value = normalized_cached

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.scalar.return_value = mock_cached_embedding

            result = cache_embedding.embed_multimodal_documents(documents)

            assert len(result) == 1
            assert result[0] == normalized_cached
            mock_model_instance.invoke_multimodal_embedding.assert_not_called()

    def test_embed_multimodal_documents_partial_cache_hit(self, mock_model_instance):
        """Test embedding multimodal documents with mixed cache hits and misses."""
        cache_embedding = CacheEmbedding(mock_model_instance)
        documents = [
            {"file_id": "cached_file"},
            {"file_id": "new_file_1"},
            {"file_id": "new_file_2"},
        ]

        cached_vector = np.random.randn(1536)
        normalized_cached = (cached_vector / np.linalg.norm(cached_vector)).tolist()

        mock_cached_embedding = Mock(spec=Embedding)
        mock_cached_embedding.get_embedding.return_value = normalized_cached

        new_embeddings = []
        for _ in range(2):
            vector = np.random.randn(1536)
            normalized = (vector / np.linalg.norm(vector)).tolist()
            new_embeddings.append(normalized)

        usage = EmbeddingUsage(
            tokens=20,
            total_tokens=20,
            unit_price=Decimal("0.0001"),
            price_unit=Decimal(1000),
            total_price=Decimal("0.000002"),
            currency="USD",
            latency=0.6,
        )

        embedding_result = EmbeddingResult(
            model="vision-embedding-model",
            embeddings=new_embeddings,
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.scalar.side_effect = [mock_cached_embedding, None, None]
            mock_model_instance.invoke_multimodal_embedding.return_value = embedding_result

            result = cache_embedding.embed_multimodal_documents(documents)

            assert len(result) == 3
            assert result[0] == normalized_cached

    def test_embed_multimodal_documents_nan_handling(self, mock_model_instance):
        """Test handling of NaN values in multimodal embeddings."""
        cache_embedding = CacheEmbedding(mock_model_instance)
        documents = [{"file_id": "valid"}, {"file_id": "nan"}]

        valid_vector = np.random.randn(1536).tolist()
        nan_vector = [float("nan")] * 1536

        usage = EmbeddingUsage(
            tokens=20,
            total_tokens=20,
            unit_price=Decimal("0.0001"),
            price_unit=Decimal(1000),
            total_price=Decimal("0.000002"),
            currency="USD",
            latency=0.5,
        )

        embedding_result = EmbeddingResult(
            model="vision-embedding-model",
            embeddings=[valid_vector, nan_vector],
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.scalar.return_value = None
            mock_model_instance.invoke_multimodal_embedding.return_value = embedding_result

            with patch("core.rag.embedding.cached_embedding.logger") as mock_logger:
                result = cache_embedding.embed_multimodal_documents(documents)

                assert len(result) == 2
                assert result[0] is not None
                assert result[1] is None

                mock_logger.warning.assert_called_once()

    def test_embed_multimodal_documents_large_batch(self, mock_model_instance):
        """Test embedding large batch of multimodal documents respecting MAX_CHUNKS."""
        cache_embedding = CacheEmbedding(mock_model_instance)
        documents = [{"file_id": f"file{i}"} for i in range(25)]

        def create_batch_result(batch_size):
            embeddings = []
            for _ in range(batch_size):
                vector = np.random.randn(1536)
                normalized = (vector / np.linalg.norm(vector)).tolist()
                embeddings.append(normalized)

            usage = EmbeddingUsage(
                tokens=batch_size * 10,
                total_tokens=batch_size * 10,
                unit_price=Decimal("0.0001"),
                price_unit=Decimal(1000),
                total_price=Decimal(str(batch_size * 0.000001)),
                currency="USD",
                latency=0.5,
            )

            return EmbeddingResult(
                model="vision-embedding-model",
                embeddings=embeddings,
                usage=usage,
            )

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.scalar.return_value = None

            batch_results = [create_batch_result(10), create_batch_result(10), create_batch_result(5)]
            mock_model_instance.invoke_multimodal_embedding.side_effect = batch_results

            result = cache_embedding.embed_multimodal_documents(documents)

            assert len(result) == 25
            assert mock_model_instance.invoke_multimodal_embedding.call_count == 3

    def test_embed_multimodal_documents_api_error(self, mock_model_instance):
        """Test handling of API errors during multimodal embedding."""
        cache_embedding = CacheEmbedding(mock_model_instance)
        documents = [{"file_id": "file123"}]

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.scalar.return_value = None
            mock_model_instance.invoke_multimodal_embedding.side_effect = Exception("API Error")

            with pytest.raises(Exception) as exc_info:
                cache_embedding.embed_multimodal_documents(documents)

            assert "API Error" in str(exc_info.value)
            mock_session.rollback.assert_called()

    def test_embed_multimodal_documents_integrity_error_during_transform(
        self, mock_model_instance, sample_multimodal_result
    ):
        """Test handling of IntegrityError during embedding transformation."""
        cache_embedding = CacheEmbedding(mock_model_instance)
        documents = [{"file_id": "file123"}]

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.scalar.return_value = None
            mock_model_instance.invoke_multimodal_embedding.return_value = sample_multimodal_result

            mock_session.commit.side_effect = IntegrityError("Duplicate key", None, None)

            result = cache_embedding.embed_multimodal_documents(documents)

            assert len(result) == 1
            mock_session.rollback.assert_called()


class TestCacheEmbeddingMultimodalQuery:
    """Test suite for CacheEmbedding.embed_multimodal_query method."""

    @pytest.fixture
    def mock_model_instance(self):
        """Create a mock ModelInstance for testing."""
        model_instance = Mock()
        model_instance.model = "vision-embedding-model"
        model_instance.model_name = "vision-embedding-model"
        model_instance.provider = "openai"
        model_instance.credentials = {"api_key": "test-key"}
        return model_instance

    def test_embed_multimodal_query_cache_miss(self, mock_model_instance):
        """Test embedding multimodal query when Redis cache is empty."""
        cache_embedding = CacheEmbedding(mock_model_instance)
        document = {"file_id": "file123"}

        vector = np.random.randn(1536)
        normalized = (vector / np.linalg.norm(vector)).tolist()

        usage = EmbeddingUsage(
            tokens=5,
            total_tokens=5,
            unit_price=Decimal("0.0001"),
            price_unit=Decimal(1000),
            total_price=Decimal("0.0000005"),
            currency="USD",
            latency=0.3,
        )

        embedding_result = EmbeddingResult(
            model="vision-embedding-model",
            embeddings=[normalized],
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.redis_client") as mock_redis:
            mock_redis.get.return_value = None
            mock_model_instance.invoke_multimodal_embedding.return_value = embedding_result

            result = cache_embedding.embed_multimodal_query(document)

            assert isinstance(result, list)
            assert len(result) == 1536
            mock_redis.setex.assert_called_once()

    def test_embed_multimodal_query_cache_hit(self, mock_model_instance):
        """Test embedding multimodal query when Redis cache has the value."""
        cache_embedding = CacheEmbedding(mock_model_instance)
        document = {"file_id": "file123"}

        embedding_vector = np.random.randn(1536)
        vector_bytes = embedding_vector.tobytes()
        encoded_vector = base64.b64encode(vector_bytes).decode("utf-8")

        with patch("core.rag.embedding.cached_embedding.redis_client") as mock_redis:
            mock_redis.get.return_value = encoded_vector.encode()

            result = cache_embedding.embed_multimodal_query(document)

            assert isinstance(result, list)
            assert len(result) == 1536
            mock_redis.expire.assert_called_once()
            mock_model_instance.invoke_multimodal_embedding.assert_not_called()

    def test_embed_multimodal_query_nan_handling(self, mock_model_instance):
        """Test handling of NaN values in multimodal query embeddings."""
        cache_embedding = CacheEmbedding(mock_model_instance)

        nan_vector = [float("nan")] * 1536

        usage = EmbeddingUsage(
            tokens=5,
            total_tokens=5,
            unit_price=Decimal("0.0001"),
            price_unit=Decimal(1000),
            total_price=Decimal("0.0000005"),
            currency="USD",
            latency=0.3,
        )

        embedding_result = EmbeddingResult(
            model="vision-embedding-model",
            embeddings=[nan_vector],
            usage=usage,
        )

        document = {"file_id": "file123"}

        with patch("core.rag.embedding.cached_embedding.redis_client") as mock_redis:
            mock_redis.get.return_value = None
            mock_model_instance.invoke_multimodal_embedding.return_value = embedding_result

            with pytest.raises(ValueError) as exc_info:
                cache_embedding.embed_multimodal_query(document)

            assert "Normalized embedding is nan" in str(exc_info.value)

    def test_embed_multimodal_query_api_error(self, mock_model_instance):
        """Test handling of API errors during multimodal query embedding."""
        cache_embedding = CacheEmbedding(mock_model_instance)
        document = {"file_id": "file123"}

        with patch("core.rag.embedding.cached_embedding.redis_client") as mock_redis:
            mock_redis.get.return_value = None
            mock_model_instance.invoke_multimodal_embedding.side_effect = Exception("API Error")

            with patch("core.rag.embedding.cached_embedding.dify_config") as mock_config:
                mock_config.DEBUG = False

                with pytest.raises(Exception) as exc_info:
                    cache_embedding.embed_multimodal_query(document)

                assert "API Error" in str(exc_info.value)

    def test_embed_multimodal_query_redis_set_error(self, mock_model_instance):
        """Test handling of Redis set errors during multimodal query embedding."""
        cache_embedding = CacheEmbedding(mock_model_instance)
        document = {"file_id": "file123"}

        vector = np.random.randn(1536)
        normalized = (vector / np.linalg.norm(vector)).tolist()

        usage = EmbeddingUsage(
            tokens=5,
            total_tokens=5,
            unit_price=Decimal("0.0001"),
            price_unit=Decimal(1000),
            total_price=Decimal("0.0000005"),
            currency="USD",
            latency=0.3,
        )

        embedding_result = EmbeddingResult(
            model="vision-embedding-model",
            embeddings=[normalized],
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.redis_client") as mock_redis:
            mock_redis.get.return_value = None
            mock_model_instance.invoke_multimodal_embedding.return_value = embedding_result
            mock_redis.setex.side_effect = RuntimeError("Redis Error")

            with patch("core.rag.embedding.cached_embedding.dify_config") as mock_config:
                mock_config.DEBUG = True

                with pytest.raises(RuntimeError):
                    cache_embedding.embed_multimodal_query(document)


class TestCacheEmbeddingQueryErrors:
    """Test suite for error handling in CacheEmbedding.embed_query method."""

    @pytest.fixture
    def mock_model_instance(self):
        """Create a mock ModelInstance for testing."""
        model_instance = Mock()
        model_instance.model = "text-embedding-ada-002"
        model_instance.model_name = "text-embedding-ada-002"
        model_instance.provider = "openai"
        model_instance.credentials = {"api_key": "test-key"}
        return model_instance

    def test_embed_query_api_error_debug_mode(self, mock_model_instance):
        """Test handling of API errors in debug mode."""
        cache_embedding = CacheEmbedding(mock_model_instance)
        query = "test query"

        with patch("core.rag.embedding.cached_embedding.redis_client") as mock_redis:
            mock_redis.get.return_value = None
            mock_model_instance.invoke_text_embedding.side_effect = RuntimeError("API Error")

            with patch("core.rag.embedding.cached_embedding.dify_config") as mock_config:
                mock_config.DEBUG = True

                with patch("core.rag.embedding.cached_embedding.logger") as mock_logger:
                    with pytest.raises(RuntimeError) as exc_info:
                        cache_embedding.embed_query(query)

                    assert "API Error" in str(exc_info.value)
                    mock_logger.exception.assert_called()

    def test_embed_query_redis_set_error_debug_mode(self, mock_model_instance):
        """Test handling of Redis set errors in debug mode."""
        cache_embedding = CacheEmbedding(mock_model_instance)
        query = "test query"

        vector = np.random.randn(1536)
        normalized = (vector / np.linalg.norm(vector)).tolist()

        usage = EmbeddingUsage(
            tokens=5,
            total_tokens=5,
            unit_price=Decimal("0.0001"),
            price_unit=Decimal(1000),
            total_price=Decimal("0.0000005"),
            currency="USD",
            latency=0.3,
        )

        embedding_result = EmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=[normalized],
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.redis_client") as mock_redis:
            mock_redis.get.return_value = None
            mock_model_instance.invoke_text_embedding.return_value = embedding_result
            mock_redis.setex.side_effect = RuntimeError("Redis Error")

            with patch("core.rag.embedding.cached_embedding.dify_config") as mock_config:
                mock_config.DEBUG = True

                with patch("core.rag.embedding.cached_embedding.logger") as mock_logger:
                    with pytest.raises(RuntimeError):
                        cache_embedding.embed_query(query)

                    mock_logger.exception.assert_called()


class TestCacheEmbeddingInitialization:
    """Test suite for CacheEmbedding initialization."""

    def test_initialization_sets_model_instance(self):
        """Test CacheEmbedding initialization stores the provided model instance."""
        model_instance = Mock()
        model_instance.model = "test-model"
        model_instance.model_name = "test-model"
        model_instance.provider = "test-provider"

        cache_embedding = CacheEmbedding(model_instance)

        assert cache_embedding._model_instance == model_instance
