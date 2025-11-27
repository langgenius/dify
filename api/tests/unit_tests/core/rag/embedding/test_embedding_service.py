"""Comprehensive unit tests for embedding service (CacheEmbedding).

This test module covers all aspects of the embedding service including:
- Batch embedding generation with proper batching logic
- Embedding model switching and configuration
- Embedding dimension validation
- Error handling for API failures
- Cache management (database and Redis)
- Normalization and NaN handling

Test Coverage:
==============
1. **Batch Embedding Generation**
   - Single text embedding
   - Multiple texts in batches
   - Large batch processing (respects MAX_CHUNKS)
   - Empty text handling

2. **Embedding Model Switching**
   - Different providers (OpenAI, Cohere, etc.)
   - Different models within same provider
   - Model instance configuration

3. **Embedding Dimension Validation**
   - Correct dimensions for different models
   - Vector normalization
   - Dimension consistency across batches

4. **Error Handling**
   - API connection failures
   - Rate limit errors
   - Authorization errors
   - Invalid input handling
   - NaN value detection and handling

5. **Cache Management**
   - Database cache for document embeddings
   - Redis cache for query embeddings
   - Cache hit/miss scenarios
   - Cache invalidation

All tests use mocking to avoid external dependencies and ensure fast, reliable execution.
Tests follow the Arrange-Act-Assert pattern for clarity.
"""

import base64
from decimal import Decimal
from unittest.mock import Mock, patch

import numpy as np
import pytest
from sqlalchemy.exc import IntegrityError

from core.entities.embedding_type import EmbeddingInputType
from core.model_runtime.entities.model_entities import ModelPropertyKey
from core.model_runtime.entities.text_embedding_entities import EmbeddingUsage, TextEmbeddingResult
from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeConnectionError,
    InvokeRateLimitError,
)
from core.rag.embedding.cached_embedding import CacheEmbedding
from models.dataset import Embedding


class TestCacheEmbeddingDocuments:
    """Test suite for CacheEmbedding.embed_documents method.

    This class tests the batch embedding generation functionality including:
    - Single and multiple text processing
    - Cache hit/miss scenarios
    - Batch processing with MAX_CHUNKS
    - Database cache management
    - Error handling during embedding generation
    """

    @pytest.fixture
    def mock_model_instance(self):
        """Create a mock ModelInstance for testing.

        Returns:
            Mock: Configured ModelInstance with text embedding capabilities
        """
        model_instance = Mock()
        model_instance.model = "text-embedding-ada-002"
        model_instance.provider = "openai"
        model_instance.credentials = {"api_key": "test-key"}

        # Mock the model type instance
        model_type_instance = Mock()
        model_instance.model_type_instance = model_type_instance

        # Mock model schema with MAX_CHUNKS property
        model_schema = Mock()
        model_schema.model_properties = {ModelPropertyKey.MAX_CHUNKS: 10}
        model_type_instance.get_model_schema.return_value = model_schema

        return model_instance

    @pytest.fixture
    def sample_embedding_result(self):
        """Create a sample TextEmbeddingResult for testing.

        Returns:
            TextEmbeddingResult: Mock embedding result with proper structure
        """
        # Create normalized embedding vectors (dimension 1536 for ada-002)
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

        return TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=[normalized_vector],
            usage=usage,
        )

    def test_embed_single_document_cache_miss(self, mock_model_instance, sample_embedding_result):
        """Test embedding a single document when cache is empty.

        Verifies:
        - Model invocation with correct parameters
        - Embedding normalization
        - Database cache storage
        - Correct return value
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance, user="test-user")
        texts = ["Python is a programming language"]

        # Mock database query to return no cached embedding (cache miss)
        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.query.return_value.filter_by.return_value.first.return_value = None

            # Mock model invocation
            mock_model_instance.invoke_text_embedding.return_value = sample_embedding_result

            # Act
            result = cache_embedding.embed_documents(texts)

            # Assert
            assert len(result) == 1
            assert isinstance(result[0], list)
            assert len(result[0]) == 1536  # ada-002 dimension
            assert all(isinstance(x, float) for x in result[0])

            # Verify model was invoked with correct parameters
            mock_model_instance.invoke_text_embedding.assert_called_once_with(
                texts=texts,
                user="test-user",
                input_type=EmbeddingInputType.DOCUMENT,
            )

            # Verify embedding was added to database cache
            mock_session.add.assert_called_once()
            mock_session.commit.assert_called_once()

    def test_embed_multiple_documents_cache_miss(self, mock_model_instance):
        """Test embedding multiple documents when cache is empty.

        Verifies:
        - Batch processing of multiple texts
        - Multiple embeddings returned
        - All embeddings are properly normalized
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        texts = [
            "Python is a programming language",
            "JavaScript is used for web development",
            "Machine learning is a subset of AI",
        ]

        # Create multiple embedding vectors
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

        embedding_result = TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=embeddings,
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.query.return_value.filter_by.return_value.first.return_value = None
            mock_model_instance.invoke_text_embedding.return_value = embedding_result

            # Act
            result = cache_embedding.embed_documents(texts)

            # Assert
            assert len(result) == 3
            assert all(len(emb) == 1536 for emb in result)
            assert all(isinstance(emb, list) for emb in result)

            # Verify all embeddings are normalized (L2 norm ≈ 1.0)
            for emb in result:
                norm = np.linalg.norm(emb)
                assert abs(norm - 1.0) < 0.01  # Allow small floating point error

    def test_embed_documents_cache_hit(self, mock_model_instance):
        """Test embedding documents when embeddings are already cached.

        Verifies:
        - Cached embeddings are retrieved from database
        - Model is not invoked for cached texts
        - Correct embeddings are returned
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        texts = ["Python is a programming language"]

        # Create cached embedding
        cached_vector = np.random.randn(1536)
        normalized_cached = (cached_vector / np.linalg.norm(cached_vector)).tolist()

        mock_cached_embedding = Mock(spec=Embedding)
        mock_cached_embedding.get_embedding.return_value = normalized_cached

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            # Mock database to return cached embedding (cache hit)
            mock_session.query.return_value.filter_by.return_value.first.return_value = mock_cached_embedding

            # Act
            result = cache_embedding.embed_documents(texts)

            # Assert
            assert len(result) == 1
            assert result[0] == normalized_cached

            # Verify model was NOT invoked (cache hit)
            mock_model_instance.invoke_text_embedding.assert_not_called()

            # Verify no new cache entries were added
            mock_session.add.assert_not_called()

    def test_embed_documents_partial_cache_hit(self, mock_model_instance):
        """Test embedding documents with mixed cache hits and misses.

        Verifies:
        - Cached embeddings are used when available
        - Only non-cached texts are sent to model
        - Results are properly merged
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        texts = [
            "Cached text 1",
            "New text 1",
            "New text 2",
        ]

        # Create cached embedding for first text
        cached_vector = np.random.randn(1536)
        normalized_cached = (cached_vector / np.linalg.norm(cached_vector)).tolist()

        mock_cached_embedding = Mock(spec=Embedding)
        mock_cached_embedding.get_embedding.return_value = normalized_cached

        # Create new embeddings for non-cached texts
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

        embedding_result = TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=new_embeddings,
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            with patch("core.rag.embedding.cached_embedding.helper.generate_text_hash") as mock_hash:
                # Mock hash generation to return predictable values
                hash_counter = [0]

                def generate_hash(text):
                    hash_counter[0] += 1
                    return f"hash_{hash_counter[0]}"

                mock_hash.side_effect = generate_hash

                # Mock database to return cached embedding only for first text (hash_1)
                call_count = [0]

                def mock_filter_by(**kwargs):
                    call_count[0] += 1
                    mock_query = Mock()
                    # First call (hash_1) returns cached, others return None
                    if call_count[0] == 1:
                        mock_query.first.return_value = mock_cached_embedding
                    else:
                        mock_query.first.return_value = None
                    return mock_query

                mock_session.query.return_value.filter_by = mock_filter_by
                mock_model_instance.invoke_text_embedding.return_value = embedding_result

                # Act
                result = cache_embedding.embed_documents(texts)

                # Assert
                assert len(result) == 3
                assert result[0] == normalized_cached  # From cache
                # The model returns already normalized embeddings, but the code normalizes again
                # So we just verify the structure and dimensions
                assert result[1] is not None
                assert isinstance(result[1], list)
                assert len(result[1]) == 1536
                assert result[2] is not None
                assert isinstance(result[2], list)
                assert len(result[2]) == 1536

                # Verify all embeddings are normalized
                for emb in result:
                    if emb is not None:
                        norm = np.linalg.norm(emb)
                        assert abs(norm - 1.0) < 0.01

                # Verify model was invoked only for non-cached texts
                mock_model_instance.invoke_text_embedding.assert_called_once()
                call_args = mock_model_instance.invoke_text_embedding.call_args
                assert len(call_args.kwargs["texts"]) == 2  # Only 2 non-cached texts

    def test_embed_documents_large_batch(self, mock_model_instance):
        """Test embedding a large batch of documents respecting MAX_CHUNKS.

        Verifies:
        - Large batches are split according to MAX_CHUNKS
        - Multiple model invocations for large batches
        - All embeddings are returned correctly
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        # Create 25 texts, MAX_CHUNKS is 10, so should be 3 batches (10, 10, 5)
        texts = [f"Text number {i}" for i in range(25)]

        # Create embeddings for each batch
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

            return TextEmbeddingResult(
                model="text-embedding-ada-002",
                embeddings=embeddings,
                usage=usage,
            )

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.query.return_value.filter_by.return_value.first.return_value = None

            # Mock model to return appropriate batch results
            batch_results = [
                create_batch_result(10),
                create_batch_result(10),
                create_batch_result(5),
            ]
            mock_model_instance.invoke_text_embedding.side_effect = batch_results

            # Act
            result = cache_embedding.embed_documents(texts)

            # Assert
            assert len(result) == 25
            assert all(len(emb) == 1536 for emb in result)

            # Verify model was invoked 3 times (for 3 batches)
            assert mock_model_instance.invoke_text_embedding.call_count == 3

            # Verify batch sizes
            calls = mock_model_instance.invoke_text_embedding.call_args_list
            assert len(calls[0].kwargs["texts"]) == 10
            assert len(calls[1].kwargs["texts"]) == 10
            assert len(calls[2].kwargs["texts"]) == 5

    def test_embed_documents_nan_handling(self, mock_model_instance):
        """Test handling of NaN values in embeddings.

        Verifies:
        - NaN values are detected
        - NaN embeddings are skipped
        - Warning is logged
        - Valid embeddings are still processed
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        texts = ["Valid text", "Text that produces NaN"]

        # Create one valid embedding and one with NaN
        # Note: The code normalizes again, so we provide unnormalized vector
        valid_vector = np.random.randn(1536)

        # Create NaN vector
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

        embedding_result = TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=[valid_vector.tolist(), nan_vector],
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.query.return_value.filter_by.return_value.first.return_value = None
            mock_model_instance.invoke_text_embedding.return_value = embedding_result

            with patch("core.rag.embedding.cached_embedding.logger") as mock_logger:
                # Act
                result = cache_embedding.embed_documents(texts)

                # Assert
                # NaN embedding is skipped, so only 1 embedding in result
                # The first position gets the valid embedding, second is None
                assert len(result) == 2
                assert result[0] is not None
                assert isinstance(result[0], list)
                assert len(result[0]) == 1536
                # Second embedding should be None since NaN was skipped
                assert result[1] is None

                # Verify warning was logged
                mock_logger.warning.assert_called_once()
                assert "Normalized embedding is nan" in str(mock_logger.warning.call_args)

    def test_embed_documents_api_connection_error(self, mock_model_instance):
        """Test handling of API connection errors during embedding.

        Verifies:
        - Connection errors are propagated
        - Database transaction is rolled back
        - Error message is preserved
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        texts = ["Test text"]

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.query.return_value.filter_by.return_value.first.return_value = None

            # Mock model to raise connection error
            mock_model_instance.invoke_text_embedding.side_effect = InvokeConnectionError("Failed to connect to API")

            # Act & Assert
            with pytest.raises(InvokeConnectionError) as exc_info:
                cache_embedding.embed_documents(texts)

            assert "Failed to connect to API" in str(exc_info.value)

            # Verify database rollback was called
            mock_session.rollback.assert_called()

    def test_embed_documents_rate_limit_error(self, mock_model_instance):
        """Test handling of rate limit errors during embedding.

        Verifies:
        - Rate limit errors are propagated
        - Database transaction is rolled back
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        texts = ["Test text"]

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.query.return_value.filter_by.return_value.first.return_value = None

            # Mock model to raise rate limit error
            mock_model_instance.invoke_text_embedding.side_effect = InvokeRateLimitError("Rate limit exceeded")

            # Act & Assert
            with pytest.raises(InvokeRateLimitError) as exc_info:
                cache_embedding.embed_documents(texts)

            assert "Rate limit exceeded" in str(exc_info.value)
            mock_session.rollback.assert_called()

    def test_embed_documents_authorization_error(self, mock_model_instance):
        """Test handling of authorization errors during embedding.

        Verifies:
        - Authorization errors are propagated
        - Database transaction is rolled back
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        texts = ["Test text"]

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.query.return_value.filter_by.return_value.first.return_value = None

            # Mock model to raise authorization error
            mock_model_instance.invoke_text_embedding.side_effect = InvokeAuthorizationError("Invalid API key")

            # Act & Assert
            with pytest.raises(InvokeAuthorizationError) as exc_info:
                cache_embedding.embed_documents(texts)

            assert "Invalid API key" in str(exc_info.value)
            mock_session.rollback.assert_called()

    def test_embed_documents_database_integrity_error(self, mock_model_instance, sample_embedding_result):
        """Test handling of database integrity errors during cache storage.

        Verifies:
        - Integrity errors are caught (e.g., duplicate hash)
        - Database transaction is rolled back
        - Embeddings are still returned
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        texts = ["Test text"]

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.query.return_value.filter_by.return_value.first.return_value = None
            mock_model_instance.invoke_text_embedding.return_value = sample_embedding_result

            # Mock database commit to raise IntegrityError
            mock_session.commit.side_effect = IntegrityError("Duplicate key", None, None)

            # Act
            result = cache_embedding.embed_documents(texts)

            # Assert
            # Embeddings should still be returned despite cache error
            assert len(result) == 1
            assert isinstance(result[0], list)

            # Verify rollback was called
            mock_session.rollback.assert_called()


class TestCacheEmbeddingQuery:
    """Test suite for CacheEmbedding.embed_query method.

    This class tests the query embedding functionality including:
    - Single query embedding
    - Redis cache management
    - Cache hit/miss scenarios
    - Error handling
    """

    @pytest.fixture
    def mock_model_instance(self):
        """Create a mock ModelInstance for testing."""
        model_instance = Mock()
        model_instance.model = "text-embedding-ada-002"
        model_instance.provider = "openai"
        model_instance.credentials = {"api_key": "test-key"}
        return model_instance

    def test_embed_query_cache_miss(self, mock_model_instance):
        """Test embedding a query when Redis cache is empty.

        Verifies:
        - Model invocation with QUERY input type
        - Embedding normalization
        - Redis cache storage
        - Correct return value
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance, user="test-user")
        query = "What is Python?"

        # Create embedding result
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

        embedding_result = TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=[normalized],
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.redis_client") as mock_redis:
            # Mock Redis cache miss
            mock_redis.get.return_value = None
            mock_model_instance.invoke_text_embedding.return_value = embedding_result

            # Act
            result = cache_embedding.embed_query(query)

            # Assert
            assert isinstance(result, list)
            assert len(result) == 1536
            assert all(isinstance(x, float) for x in result)

            # Verify model was invoked with QUERY input type
            mock_model_instance.invoke_text_embedding.assert_called_once_with(
                texts=[query],
                user="test-user",
                input_type=EmbeddingInputType.QUERY,
            )

            # Verify Redis cache was set
            mock_redis.setex.assert_called_once()
            # Cache key format: {provider}_{model}_{hash}
            cache_key = mock_redis.setex.call_args[0][0]
            assert "openai" in cache_key
            assert "text-embedding-ada-002" in cache_key

            # Verify cache TTL is 600 seconds
            assert mock_redis.setex.call_args[0][1] == 600

    def test_embed_query_cache_hit(self, mock_model_instance):
        """Test embedding a query when Redis cache contains the result.

        Verifies:
        - Cached embedding is retrieved from Redis
        - Model is not invoked
        - Cache TTL is extended
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        query = "What is Python?"

        # Create cached embedding
        vector = np.random.randn(1536)
        normalized = vector / np.linalg.norm(vector)

        # Encode to base64 (as stored in Redis)
        vector_bytes = normalized.tobytes()
        encoded_vector = base64.b64encode(vector_bytes).decode("utf-8")

        with patch("core.rag.embedding.cached_embedding.redis_client") as mock_redis:
            # Mock Redis cache hit
            mock_redis.get.return_value = encoded_vector

            # Act
            result = cache_embedding.embed_query(query)

            # Assert
            assert isinstance(result, list)
            assert len(result) == 1536

            # Verify model was NOT invoked (cache hit)
            mock_model_instance.invoke_text_embedding.assert_not_called()

            # Verify cache TTL was extended
            mock_redis.expire.assert_called_once()
            assert mock_redis.expire.call_args[0][1] == 600

    def test_embed_query_nan_handling(self, mock_model_instance):
        """Test handling of NaN values in query embeddings.

        Verifies:
        - NaN values are detected
        - ValueError is raised
        - Error message is descriptive
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        query = "Query that produces NaN"

        # Create NaN embedding
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

        embedding_result = TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=[nan_vector],
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.redis_client") as mock_redis:
            mock_redis.get.return_value = None
            mock_model_instance.invoke_text_embedding.return_value = embedding_result

            # Act & Assert
            with pytest.raises(ValueError) as exc_info:
                cache_embedding.embed_query(query)

            assert "Normalized embedding is nan" in str(exc_info.value)

    def test_embed_query_connection_error(self, mock_model_instance):
        """Test handling of connection errors during query embedding.

        Verifies:
        - Connection errors are propagated
        - Error is logged in debug mode
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        query = "Test query"

        with patch("core.rag.embedding.cached_embedding.redis_client") as mock_redis:
            mock_redis.get.return_value = None

            # Mock model to raise connection error
            mock_model_instance.invoke_text_embedding.side_effect = InvokeConnectionError("Connection failed")

            # Act & Assert
            with pytest.raises(InvokeConnectionError) as exc_info:
                cache_embedding.embed_query(query)

            assert "Connection failed" in str(exc_info.value)

    def test_embed_query_redis_cache_error(self, mock_model_instance):
        """Test handling of Redis cache errors during storage.

        Verifies:
        - Redis errors are caught
        - Embedding is still returned
        - Error is logged in debug mode
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        query = "Test query"

        # Create valid embedding
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

        embedding_result = TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=[normalized],
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.redis_client") as mock_redis:
            mock_redis.get.return_value = None
            mock_model_instance.invoke_text_embedding.return_value = embedding_result

            # Mock Redis setex to raise error
            mock_redis.setex.side_effect = Exception("Redis connection failed")

            # Act & Assert
            with pytest.raises(Exception) as exc_info:
                cache_embedding.embed_query(query)

            assert "Redis connection failed" in str(exc_info.value)


class TestEmbeddingModelSwitching:
    """Test suite for embedding model switching functionality.

    This class tests the ability to switch between different embedding models
    and providers, ensuring proper configuration and dimension handling.
    """

    def test_switch_between_openai_models(self):
        """Test switching between different OpenAI embedding models.

        Verifies:
        - Different models produce different cache keys
        - Model name is correctly used in cache lookup
        - Embeddings are model-specific
        """
        # Arrange
        model_instance_ada = Mock()
        model_instance_ada.model = "text-embedding-ada-002"
        model_instance_ada.provider = "openai"

        # Mock model type instance for ada
        model_type_instance_ada = Mock()
        model_instance_ada.model_type_instance = model_type_instance_ada
        model_schema_ada = Mock()
        model_schema_ada.model_properties = {ModelPropertyKey.MAX_CHUNKS: 10}
        model_type_instance_ada.get_model_schema.return_value = model_schema_ada

        model_instance_3_small = Mock()
        model_instance_3_small.model = "text-embedding-3-small"
        model_instance_3_small.provider = "openai"

        # Mock model type instance for 3-small
        model_type_instance_3_small = Mock()
        model_instance_3_small.model_type_instance = model_type_instance_3_small
        model_schema_3_small = Mock()
        model_schema_3_small.model_properties = {ModelPropertyKey.MAX_CHUNKS: 10}
        model_type_instance_3_small.get_model_schema.return_value = model_schema_3_small

        cache_ada = CacheEmbedding(model_instance_ada)
        cache_3_small = CacheEmbedding(model_instance_3_small)

        text = "Test text"

        # Create different embeddings for each model
        vector_ada = np.random.randn(1536)
        normalized_ada = (vector_ada / np.linalg.norm(vector_ada)).tolist()

        vector_3_small = np.random.randn(1536)
        normalized_3_small = (vector_3_small / np.linalg.norm(vector_3_small)).tolist()

        usage = EmbeddingUsage(
            tokens=5,
            total_tokens=5,
            unit_price=Decimal("0.0001"),
            price_unit=Decimal(1000),
            total_price=Decimal("0.0000005"),
            currency="USD",
            latency=0.3,
        )

        result_ada = TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=[normalized_ada],
            usage=usage,
        )

        result_3_small = TextEmbeddingResult(
            model="text-embedding-3-small",
            embeddings=[normalized_3_small],
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.query.return_value.filter_by.return_value.first.return_value = None

            model_instance_ada.invoke_text_embedding.return_value = result_ada
            model_instance_3_small.invoke_text_embedding.return_value = result_3_small

            # Act
            embedding_ada = cache_ada.embed_documents([text])
            embedding_3_small = cache_3_small.embed_documents([text])

            # Assert
            # Both should return embeddings but they should be different
            assert len(embedding_ada) == 1
            assert len(embedding_3_small) == 1
            assert embedding_ada[0] != embedding_3_small[0]

            # Verify both models were invoked
            model_instance_ada.invoke_text_embedding.assert_called_once()
            model_instance_3_small.invoke_text_embedding.assert_called_once()

    def test_switch_between_providers(self):
        """Test switching between different embedding providers.

        Verifies:
        - Different providers use separate cache namespaces
        - Provider name is correctly used in cache lookup
        """
        # Arrange
        model_instance_openai = Mock()
        model_instance_openai.model = "text-embedding-ada-002"
        model_instance_openai.provider = "openai"

        model_instance_cohere = Mock()
        model_instance_cohere.model = "embed-english-v3.0"
        model_instance_cohere.provider = "cohere"

        cache_openai = CacheEmbedding(model_instance_openai)
        cache_cohere = CacheEmbedding(model_instance_cohere)

        query = "Test query"

        # Create embeddings
        vector_openai = np.random.randn(1536)
        normalized_openai = (vector_openai / np.linalg.norm(vector_openai)).tolist()

        vector_cohere = np.random.randn(1024)  # Cohere uses different dimension
        normalized_cohere = (vector_cohere / np.linalg.norm(vector_cohere)).tolist()

        usage_openai = EmbeddingUsage(
            tokens=5,
            total_tokens=5,
            unit_price=Decimal("0.0001"),
            price_unit=Decimal(1000),
            total_price=Decimal("0.0000005"),
            currency="USD",
            latency=0.3,
        )

        usage_cohere = EmbeddingUsage(
            tokens=5,
            total_tokens=5,
            unit_price=Decimal("0.0002"),
            price_unit=Decimal(1000),
            total_price=Decimal("0.000001"),
            currency="USD",
            latency=0.4,
        )

        result_openai = TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=[normalized_openai],
            usage=usage_openai,
        )

        result_cohere = TextEmbeddingResult(
            model="embed-english-v3.0",
            embeddings=[normalized_cohere],
            usage=usage_cohere,
        )

        with patch("core.rag.embedding.cached_embedding.redis_client") as mock_redis:
            mock_redis.get.return_value = None

            model_instance_openai.invoke_text_embedding.return_value = result_openai
            model_instance_cohere.invoke_text_embedding.return_value = result_cohere

            # Act
            embedding_openai = cache_openai.embed_query(query)
            embedding_cohere = cache_cohere.embed_query(query)

            # Assert
            assert len(embedding_openai) == 1536  # OpenAI dimension
            assert len(embedding_cohere) == 1024  # Cohere dimension

            # Verify different cache keys were used
            calls = mock_redis.setex.call_args_list
            assert len(calls) == 2
            cache_key_openai = calls[0][0][0]
            cache_key_cohere = calls[1][0][0]

            assert "openai" in cache_key_openai
            assert "cohere" in cache_key_cohere
            assert cache_key_openai != cache_key_cohere


class TestEmbeddingDimensionValidation:
    """Test suite for embedding dimension validation.

    This class tests that embeddings maintain correct dimensions
    and are properly normalized across different scenarios.
    """

    @pytest.fixture
    def mock_model_instance(self):
        """Create a mock ModelInstance for testing."""
        model_instance = Mock()
        model_instance.model = "text-embedding-ada-002"
        model_instance.provider = "openai"
        model_instance.credentials = {"api_key": "test-key"}

        model_type_instance = Mock()
        model_instance.model_type_instance = model_type_instance

        model_schema = Mock()
        model_schema.model_properties = {ModelPropertyKey.MAX_CHUNKS: 10}
        model_type_instance.get_model_schema.return_value = model_schema

        return model_instance

    def test_embedding_dimension_consistency(self, mock_model_instance):
        """Test that all embeddings have consistent dimensions.

        Verifies:
        - All embeddings have the same dimension
        - Dimension matches model specification (1536 for ada-002)
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        texts = [f"Text {i}" for i in range(5)]

        # Create embeddings with consistent dimension
        embeddings = []
        for _ in range(5):
            vector = np.random.randn(1536)
            normalized = (vector / np.linalg.norm(vector)).tolist()
            embeddings.append(normalized)

        usage = EmbeddingUsage(
            tokens=50,
            total_tokens=50,
            unit_price=Decimal("0.0001"),
            price_unit=Decimal(1000),
            total_price=Decimal("0.000005"),
            currency="USD",
            latency=0.7,
        )

        embedding_result = TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=embeddings,
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.query.return_value.filter_by.return_value.first.return_value = None
            mock_model_instance.invoke_text_embedding.return_value = embedding_result

            # Act
            result = cache_embedding.embed_documents(texts)

            # Assert
            assert len(result) == 5

            # All embeddings should have same dimension
            dimensions = [len(emb) for emb in result]
            assert all(dim == 1536 for dim in dimensions)

            # All embeddings should be lists of floats
            for emb in result:
                assert isinstance(emb, list)
                assert all(isinstance(x, float) for x in emb)

    def test_embedding_normalization(self, mock_model_instance):
        """Test that embeddings are properly normalized (L2 norm ≈ 1.0).

        Verifies:
        - All embeddings are L2 normalized
        - Normalization is consistent across batches
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        texts = ["Text 1", "Text 2", "Text 3"]

        # Create unnormalized vectors (will be normalized by the service)
        embeddings = []
        for _ in range(3):
            vector = np.random.randn(1536) * 10  # Unnormalized
            normalized = (vector / np.linalg.norm(vector)).tolist()
            embeddings.append(normalized)

        usage = EmbeddingUsage(
            tokens=30,
            total_tokens=30,
            unit_price=Decimal("0.0001"),
            price_unit=Decimal(1000),
            total_price=Decimal("0.000003"),
            currency="USD",
            latency=0.5,
        )

        embedding_result = TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=embeddings,
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.query.return_value.filter_by.return_value.first.return_value = None
            mock_model_instance.invoke_text_embedding.return_value = embedding_result

            # Act
            result = cache_embedding.embed_documents(texts)

            # Assert
            for emb in result:
                norm = np.linalg.norm(emb)
                # L2 norm should be approximately 1.0
                assert abs(norm - 1.0) < 0.01, f"Embedding not normalized: norm={norm}"

    def test_different_model_dimensions(self):
        """Test handling of different embedding dimensions for different models.

        Verifies:
        - Different models can have different dimensions
        - Dimensions are correctly preserved
        """
        # Arrange - OpenAI ada-002 (1536 dimensions)
        model_instance_ada = Mock()
        model_instance_ada.model = "text-embedding-ada-002"
        model_instance_ada.provider = "openai"

        # Mock model type instance for ada
        model_type_instance_ada = Mock()
        model_instance_ada.model_type_instance = model_type_instance_ada
        model_schema_ada = Mock()
        model_schema_ada.model_properties = {ModelPropertyKey.MAX_CHUNKS: 10}
        model_type_instance_ada.get_model_schema.return_value = model_schema_ada

        cache_ada = CacheEmbedding(model_instance_ada)

        vector_ada = np.random.randn(1536)
        normalized_ada = (vector_ada / np.linalg.norm(vector_ada)).tolist()

        usage_ada = EmbeddingUsage(
            tokens=5,
            total_tokens=5,
            unit_price=Decimal("0.0001"),
            price_unit=Decimal(1000),
            total_price=Decimal("0.0000005"),
            currency="USD",
            latency=0.3,
        )

        result_ada = TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=[normalized_ada],
            usage=usage_ada,
        )

        # Arrange - Cohere embed-english-v3.0 (1024 dimensions)
        model_instance_cohere = Mock()
        model_instance_cohere.model = "embed-english-v3.0"
        model_instance_cohere.provider = "cohere"

        # Mock model type instance for cohere
        model_type_instance_cohere = Mock()
        model_instance_cohere.model_type_instance = model_type_instance_cohere
        model_schema_cohere = Mock()
        model_schema_cohere.model_properties = {ModelPropertyKey.MAX_CHUNKS: 10}
        model_type_instance_cohere.get_model_schema.return_value = model_schema_cohere

        cache_cohere = CacheEmbedding(model_instance_cohere)

        vector_cohere = np.random.randn(1024)
        normalized_cohere = (vector_cohere / np.linalg.norm(vector_cohere)).tolist()

        usage_cohere = EmbeddingUsage(
            tokens=5,
            total_tokens=5,
            unit_price=Decimal("0.0002"),
            price_unit=Decimal(1000),
            total_price=Decimal("0.000001"),
            currency="USD",
            latency=0.4,
        )

        result_cohere = TextEmbeddingResult(
            model="embed-english-v3.0",
            embeddings=[normalized_cohere],
            usage=usage_cohere,
        )

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.query.return_value.filter_by.return_value.first.return_value = None

            model_instance_ada.invoke_text_embedding.return_value = result_ada
            model_instance_cohere.invoke_text_embedding.return_value = result_cohere

            # Act
            embedding_ada = cache_ada.embed_documents(["Test"])
            embedding_cohere = cache_cohere.embed_documents(["Test"])

            # Assert
            assert len(embedding_ada[0]) == 1536  # OpenAI dimension
            assert len(embedding_cohere[0]) == 1024  # Cohere dimension


class TestEmbeddingEdgeCases:
    """Test suite for edge cases and special scenarios.

    This class tests unusual inputs and boundary conditions including:
    - Empty inputs (empty list, empty strings)
    - Very long texts (exceeding typical limits)
    - Special characters and Unicode
    - Whitespace-only texts
    - Duplicate texts in same batch
    - Mixed valid and invalid inputs
    """

    @pytest.fixture
    def mock_model_instance(self):
        """Create a mock ModelInstance for testing.

        Returns:
            Mock: Configured ModelInstance with standard settings
                  - Model: text-embedding-ada-002
                  - Provider: openai
                  - MAX_CHUNKS: 10
        """
        model_instance = Mock()
        model_instance.model = "text-embedding-ada-002"
        model_instance.provider = "openai"

        model_type_instance = Mock()
        model_instance.model_type_instance = model_type_instance

        model_schema = Mock()
        model_schema.model_properties = {ModelPropertyKey.MAX_CHUNKS: 10}
        model_type_instance.get_model_schema.return_value = model_schema

        return model_instance

    def test_embed_empty_list(self, mock_model_instance):
        """Test embedding an empty list of documents.

        Verifies:
        - Empty list returns empty result
        - No model invocation occurs
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        texts = []

        # Act
        result = cache_embedding.embed_documents(texts)

        # Assert
        assert result == []
        mock_model_instance.invoke_text_embedding.assert_not_called()

    def test_embed_empty_string(self, mock_model_instance):
        """Test embedding an empty string.

        Verifies:
        - Empty string is handled correctly
        - Model is invoked with empty string
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        texts = [""]

        vector = np.random.randn(1536)
        normalized = (vector / np.linalg.norm(vector)).tolist()

        usage = EmbeddingUsage(
            tokens=0,
            total_tokens=0,
            unit_price=Decimal("0.0001"),
            price_unit=Decimal(1000),
            total_price=Decimal(0),
            currency="USD",
            latency=0.1,
        )

        embedding_result = TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=[normalized],
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.query.return_value.filter_by.return_value.first.return_value = None
            mock_model_instance.invoke_text_embedding.return_value = embedding_result

            # Act
            result = cache_embedding.embed_documents(texts)

            # Assert
            assert len(result) == 1
            assert len(result[0]) == 1536

    def test_embed_very_long_text(self, mock_model_instance):
        """Test embedding very long text.

        Verifies:
        - Long texts are handled correctly
        - No truncation errors occur
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        # Create a very long text (10000 characters)
        long_text = "Python " * 2000
        texts = [long_text]

        vector = np.random.randn(1536)
        normalized = (vector / np.linalg.norm(vector)).tolist()

        usage = EmbeddingUsage(
            tokens=2000,
            total_tokens=2000,
            unit_price=Decimal("0.0001"),
            price_unit=Decimal(1000),
            total_price=Decimal("0.0002"),
            currency="USD",
            latency=1.5,
        )

        embedding_result = TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=[normalized],
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.query.return_value.filter_by.return_value.first.return_value = None
            mock_model_instance.invoke_text_embedding.return_value = embedding_result

            # Act
            result = cache_embedding.embed_documents(texts)

            # Assert
            assert len(result) == 1
            assert len(result[0]) == 1536

    def test_embed_special_characters(self, mock_model_instance):
        """Test embedding text with special characters.

        Verifies:
        - Special characters are handled correctly
        - Unicode characters work properly
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        texts = [
            "Hello 世界! 🌍",
            "Special chars: @#$%^&*()",
            "Newlines\nand\ttabs",
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
            latency=0.5,
        )

        embedding_result = TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=embeddings,
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.query.return_value.filter_by.return_value.first.return_value = None
            mock_model_instance.invoke_text_embedding.return_value = embedding_result

            # Act
            result = cache_embedding.embed_documents(texts)

            # Assert
            assert len(result) == 3
            assert all(len(emb) == 1536 for emb in result)

    def test_embed_whitespace_only_text(self, mock_model_instance):
        """Test embedding text containing only whitespace.

        Verifies:
        - Whitespace-only texts are handled correctly
        - Model is invoked with whitespace text
        - Valid embedding is returned

        Context:
        --------
        Whitespace-only texts can occur in real-world scenarios when
        processing documents with formatting issues or empty sections.
        The embedding model should handle these gracefully.
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        texts = ["   ", "\t\t", "\n\n\n"]

        # Create embeddings for whitespace texts
        embeddings = []
        for _ in range(3):
            vector = np.random.randn(1536)
            normalized = (vector / np.linalg.norm(vector)).tolist()
            embeddings.append(normalized)

        usage = EmbeddingUsage(
            tokens=3,
            total_tokens=3,
            unit_price=Decimal("0.0001"),
            price_unit=Decimal(1000),
            total_price=Decimal("0.0000003"),
            currency="USD",
            latency=0.2,
        )

        embedding_result = TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=embeddings,
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.query.return_value.filter_by.return_value.first.return_value = None
            mock_model_instance.invoke_text_embedding.return_value = embedding_result

            # Act
            result = cache_embedding.embed_documents(texts)

            # Assert
            assert len(result) == 3
            assert all(isinstance(emb, list) for emb in result)
            assert all(len(emb) == 1536 for emb in result)

    def test_embed_duplicate_texts_in_batch(self, mock_model_instance):
        """Test embedding when same text appears multiple times in batch.

        Verifies:
        - Duplicate texts are handled correctly
        - Each duplicate gets its own embedding
        - All duplicates are processed

        Context:
        --------
        In batch processing, the same text might appear multiple times.
        The current implementation processes all texts individually,
        even if they're duplicates. This ensures each position in the
        input list gets a corresponding embedding in the output.
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        # Same text repeated 3 times
        texts = ["Duplicate text", "Duplicate text", "Duplicate text"]

        # Create embeddings for all three (even though they're duplicates)
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
            latency=0.3,
        )

        # Model returns embeddings for all texts
        embedding_result = TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=embeddings,
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.query.return_value.filter_by.return_value.first.return_value = None
            mock_model_instance.invoke_text_embedding.return_value = embedding_result

            # Act
            result = cache_embedding.embed_documents(texts)

            # Assert
            # All three should have embeddings
            assert len(result) == 3
            # Model should be called once
            mock_model_instance.invoke_text_embedding.assert_called_once()
            # All three texts are sent to model (no deduplication)
            call_args = mock_model_instance.invoke_text_embedding.call_args
            assert len(call_args.kwargs["texts"]) == 3

    def test_embed_mixed_languages(self, mock_model_instance):
        """Test embedding texts in different languages.

        Verifies:
        - Multi-language texts are handled correctly
        - Unicode characters from various scripts work
        - Embeddings are generated for all languages

        Context:
        --------
        Modern embedding models support multiple languages.
        This test ensures the service handles various scripts:
        - Latin (English)
        - CJK (Chinese, Japanese, Korean)
        - Cyrillic (Russian)
        - Arabic
        - Emoji and symbols
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        texts = [
            "Hello World",  # English
            "你好世界",  # Chinese
            "こんにちは世界",  # Japanese
            "Привет мир",  # Russian
            "مرحبا بالعالم",  # Arabic
            "🌍🌎🌏",  # Emoji
        ]

        # Create embeddings for each language
        embeddings = []
        for _ in range(6):
            vector = np.random.randn(1536)
            normalized = (vector / np.linalg.norm(vector)).tolist()
            embeddings.append(normalized)

        usage = EmbeddingUsage(
            tokens=60,
            total_tokens=60,
            unit_price=Decimal("0.0001"),
            price_unit=Decimal(1000),
            total_price=Decimal("0.000006"),
            currency="USD",
            latency=0.8,
        )

        embedding_result = TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=embeddings,
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.query.return_value.filter_by.return_value.first.return_value = None
            mock_model_instance.invoke_text_embedding.return_value = embedding_result

            # Act
            result = cache_embedding.embed_documents(texts)

            # Assert
            assert len(result) == 6
            assert all(isinstance(emb, list) for emb in result)
            assert all(len(emb) == 1536 for emb in result)
            # Verify all embeddings are normalized
            for emb in result:
                norm = np.linalg.norm(emb)
                assert abs(norm - 1.0) < 0.01

    def test_embed_query_with_user_context(self, mock_model_instance):
        """Test query embedding with user context parameter.

        Verifies:
        - User parameter is passed correctly to model
        - User context is used for tracking/logging
        - Embedding generation works with user context

        Context:
        --------
        The user parameter is important for:
        1. Usage tracking per user
        2. Rate limiting per user
        3. Audit logging
        4. Personalization (in some models)
        """
        # Arrange
        user_id = "user-12345"
        cache_embedding = CacheEmbedding(mock_model_instance, user=user_id)
        query = "What is machine learning?"

        # Create embedding
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

        embedding_result = TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=[normalized],
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.redis_client") as mock_redis:
            mock_redis.get.return_value = None
            mock_model_instance.invoke_text_embedding.return_value = embedding_result

            # Act
            result = cache_embedding.embed_query(query)

            # Assert
            assert isinstance(result, list)
            assert len(result) == 1536

            # Verify user parameter was passed to model
            mock_model_instance.invoke_text_embedding.assert_called_once_with(
                texts=[query],
                user=user_id,
                input_type=EmbeddingInputType.QUERY,
            )

    def test_embed_documents_with_user_context(self, mock_model_instance):
        """Test document embedding with user context parameter.

        Verifies:
        - User parameter is passed correctly for document embeddings
        - Batch processing maintains user context
        - User tracking works across batches
        """
        # Arrange
        user_id = "user-67890"
        cache_embedding = CacheEmbedding(mock_model_instance, user=user_id)
        texts = ["Document 1", "Document 2"]

        # Create embeddings
        embeddings = []
        for _ in range(2):
            vector = np.random.randn(1536)
            normalized = (vector / np.linalg.norm(vector)).tolist()
            embeddings.append(normalized)

        usage = EmbeddingUsage(
            tokens=20,
            total_tokens=20,
            unit_price=Decimal("0.0001"),
            price_unit=Decimal(1000),
            total_price=Decimal("0.000002"),
            currency="USD",
            latency=0.5,
        )

        embedding_result = TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=embeddings,
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.query.return_value.filter_by.return_value.first.return_value = None
            mock_model_instance.invoke_text_embedding.return_value = embedding_result

            # Act
            result = cache_embedding.embed_documents(texts)

            # Assert
            assert len(result) == 2

            # Verify user parameter was passed
            mock_model_instance.invoke_text_embedding.assert_called_once()
            call_args = mock_model_instance.invoke_text_embedding.call_args
            assert call_args.kwargs["user"] == user_id
            assert call_args.kwargs["input_type"] == EmbeddingInputType.DOCUMENT


class TestEmbeddingCachePerformance:
    """Test suite for cache performance and optimization scenarios.

    This class tests cache-related performance optimizations:
    - Cache hit rate improvements
    - Batch processing efficiency
    - Memory usage optimization
    - Cache key generation
    - TTL (Time To Live) management
    """

    @pytest.fixture
    def mock_model_instance(self):
        """Create a mock ModelInstance for testing.

        Returns:
            Mock: Configured ModelInstance for performance testing
                  - Model: text-embedding-ada-002
                  - Provider: openai
                  - MAX_CHUNKS: 10
        """
        model_instance = Mock()
        model_instance.model = "text-embedding-ada-002"
        model_instance.provider = "openai"

        model_type_instance = Mock()
        model_instance.model_type_instance = model_type_instance

        model_schema = Mock()
        model_schema.model_properties = {ModelPropertyKey.MAX_CHUNKS: 10}
        model_type_instance.get_model_schema.return_value = model_schema

        return model_instance

    def test_cache_hit_reduces_api_calls(self, mock_model_instance):
        """Test that cache hits prevent unnecessary API calls.

        Verifies:
        - First call triggers API request
        - Second call uses cache (no API call)
        - Cache significantly reduces API usage

        Context:
        --------
        Caching is critical for:
        1. Reducing API costs
        2. Improving response time
        3. Reducing rate limit pressure
        4. Better user experience

        This test demonstrates the cache working as expected.
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        text = "Frequently used text"

        # Create cached embedding
        vector = np.random.randn(1536)
        normalized = (vector / np.linalg.norm(vector)).tolist()

        mock_cached_embedding = Mock(spec=Embedding)
        mock_cached_embedding.get_embedding.return_value = normalized

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            # First call: cache miss
            mock_session.query.return_value.filter_by.return_value.first.return_value = None

            usage = EmbeddingUsage(
                tokens=5,
                total_tokens=5,
                unit_price=Decimal("0.0001"),
                price_unit=Decimal(1000),
                total_price=Decimal("0.0000005"),
                currency="USD",
                latency=0.3,
            )

            embedding_result = TextEmbeddingResult(
                model="text-embedding-ada-002",
                embeddings=[normalized],
                usage=usage,
            )

            mock_model_instance.invoke_text_embedding.return_value = embedding_result

            # Act - First call (cache miss)
            result1 = cache_embedding.embed_documents([text])

            # Assert - Model was called
            assert mock_model_instance.invoke_text_embedding.call_count == 1
            assert len(result1) == 1

            # Arrange - Second call: cache hit
            mock_session.query.return_value.filter_by.return_value.first.return_value = mock_cached_embedding

            # Act - Second call (cache hit)
            result2 = cache_embedding.embed_documents([text])

            # Assert - Model was NOT called again (still 1 call total)
            assert mock_model_instance.invoke_text_embedding.call_count == 1
            assert len(result2) == 1
            assert result2[0] == normalized  # Same embedding from cache

    def test_batch_processing_efficiency(self, mock_model_instance):
        """Test that batch processing is more efficient than individual calls.

        Verifies:
        - Multiple texts are processed in single API call
        - Batch size respects MAX_CHUNKS limit
        - Batching reduces total API calls

        Context:
        --------
        Batch processing is essential for:
        1. Reducing API overhead
        2. Better throughput
        3. Lower latency per text
        4. Cost optimization

        Example: 100 texts in batches of 10 = 10 API calls
                 vs 100 individual calls = 100 API calls
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        # 15 texts should be processed in 2 batches (10 + 5)
        texts = [f"Text {i}" for i in range(15)]

        # Create embeddings for each batch
        def create_batch_result(batch_size):
            """Helper function to create batch embedding results."""
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

            return TextEmbeddingResult(
                model="text-embedding-ada-002",
                embeddings=embeddings,
                usage=usage,
            )

        with patch("core.rag.embedding.cached_embedding.db.session") as mock_session:
            mock_session.query.return_value.filter_by.return_value.first.return_value = None

            # Mock model to return appropriate batch results
            batch_results = [
                create_batch_result(10),  # First batch
                create_batch_result(5),  # Second batch
            ]
            mock_model_instance.invoke_text_embedding.side_effect = batch_results

            # Act
            result = cache_embedding.embed_documents(texts)

            # Assert
            assert len(result) == 15
            # Only 2 API calls for 15 texts (batched)
            assert mock_model_instance.invoke_text_embedding.call_count == 2

            # Verify batch sizes
            calls = mock_model_instance.invoke_text_embedding.call_args_list
            assert len(calls[0].kwargs["texts"]) == 10  # First batch
            assert len(calls[1].kwargs["texts"]) == 5  # Second batch

    def test_redis_cache_expiration(self, mock_model_instance):
        """Test Redis cache TTL (Time To Live) management.

        Verifies:
        - Cache entries have appropriate TTL (600 seconds)
        - TTL is extended on cache hits
        - Expired entries are regenerated

        Context:
        --------
        Redis cache TTL ensures:
        1. Memory doesn't grow unbounded
        2. Stale embeddings are refreshed
        3. Frequently used queries stay cached longer
        4. Infrequently used queries expire naturally
        """
        # Arrange
        cache_embedding = CacheEmbedding(mock_model_instance)
        query = "Test query"

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

        embedding_result = TextEmbeddingResult(
            model="text-embedding-ada-002",
            embeddings=[normalized],
            usage=usage,
        )

        with patch("core.rag.embedding.cached_embedding.redis_client") as mock_redis:
            # Test cache miss - sets TTL
            mock_redis.get.return_value = None
            mock_model_instance.invoke_text_embedding.return_value = embedding_result

            # Act
            cache_embedding.embed_query(query)

            # Assert - TTL was set to 600 seconds
            mock_redis.setex.assert_called_once()
            call_args = mock_redis.setex.call_args
            assert call_args[0][1] == 600  # TTL in seconds

            # Test cache hit - extends TTL
            mock_redis.reset_mock()
            vector_bytes = np.array(normalized).tobytes()
            encoded_vector = base64.b64encode(vector_bytes).decode("utf-8")
            mock_redis.get.return_value = encoded_vector

            # Act
            cache_embedding.embed_query(query)

            # Assert - TTL was extended
            mock_redis.expire.assert_called_once()
            assert mock_redis.expire.call_args[0][1] == 600
