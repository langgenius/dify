import base64
import logging
import pickle
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from unittest.mock import Mock, patch

import numpy as np
import pytest
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.entities.embedding_type import EmbeddingInputType
from core.rag.embedding import cached_embedding
from core.rag.embedding import cached_embedding as cached_embedding_module
from core.rag.embedding.cached_embedding import CacheEmbedding
from graphon.model_runtime.entities.model_entities import ModelPropertyKey
from graphon.model_runtime.entities.text_embedding_entities import EmbeddingResult, EmbeddingUsage
from graphon.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeConnectionError,
    InvokeRateLimitError,
)
from libs import helper
from models.dataset import Embedding

"""Unit tests for cached_embedding.py - CacheEmbedding class.

This test file covers the methods not fully tested in test_embedding_service.py:
- embed_multimodal_documents
- embed_multimodal_query
- Error handling scenarios in embed_query (DEBUG mode)
"""


@dataclass(frozen=True)
class _DatabaseBinding:
    session: Session


def _cached_embedding_persist_embedding(
    session: Session,
    *,
    cache_key: str,
    vector: list[float],
    model_name: str = "vision-embedding-model",
    provider_name: str = "openai",
) -> Embedding:
    embedding = Embedding(
        model_name=model_name,
        hash=cache_key,
        provider_name=provider_name,
        embedding=b"placeholder",
    )
    embedding.set_embedding(vector)
    session.add(embedding)
    session.commit()
    return embedding


class TestCachedEmbeddingCases:
    @staticmethod
    @pytest.fixture
    def embedding_session(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> Session:
        """Bind CacheEmbedding to the shared SQLite session."""

        monkeypatch.setattr(cached_embedding_module, "db", _DatabaseBinding(session=sqlite_session))
        return sqlite_session

    class TestCacheEmbeddingMultimodalDocuments:
        """Test suite for CacheEmbedding.embed_multimodal_documents method."""

        @pytest.fixture
        def mock_model_instance(self) -> Mock:
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
        def sample_multimodal_result(self) -> EmbeddingResult:
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

        def test_embed_single_multimodal_document_cache_miss(
            self,
            mock_model_instance: Mock,
            sample_multimodal_result: EmbeddingResult,
            embedding_session: Session,
        ) -> None:
            """Test embedding a single multimodal document when cache is empty."""
            cache_embedding = CacheEmbedding(mock_model_instance)
            documents = [{"file_id": "file123", "content": "test content"}]

            mock_model_instance.invoke_multimodal_embedding.return_value = sample_multimodal_result

            result = cache_embedding.embed_multimodal_documents(documents)

            assert len(result) == 1
            assert isinstance(result[0], list)
            assert len(result[0]) == 1536

            mock_model_instance.invoke_multimodal_embedding.assert_called_once()
            persisted = embedding_session.scalar(select(Embedding).where(Embedding.hash == "file123"))
            assert persisted is not None
            assert persisted.get_embedding() == result[0]

        def test_embed_multiple_multimodal_documents_cache_miss(
            self, mock_model_instance: Mock, embedding_session: Session
        ) -> None:
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

            mock_model_instance.invoke_multimodal_embedding.return_value = embedding_result

            result = cache_embedding.embed_multimodal_documents(documents)

            assert len(result) == 3
            assert all(len(emb) == 1536 for emb in result)
            assert embedding_session.scalar(select(func.count()).select_from(Embedding)) == 3

        def test_embed_multimodal_documents_cache_hit(
            self, mock_model_instance: Mock, embedding_session: Session
        ) -> None:
            """Test embedding multimodal documents when embeddings are cached."""
            cache_embedding = CacheEmbedding(mock_model_instance)
            documents = [{"file_id": "file123"}]

            cached_vector = np.random.randn(1536)
            normalized_cached = (cached_vector / np.linalg.norm(cached_vector)).tolist()

            _cached_embedding_persist_embedding(embedding_session, cache_key="file123", vector=normalized_cached)

            result = cache_embedding.embed_multimodal_documents(documents)

            assert len(result) == 1
            assert result[0] == normalized_cached
            mock_model_instance.invoke_multimodal_embedding.assert_not_called()

        def test_embed_multimodal_documents_partial_cache_hit(
            self, mock_model_instance: Mock, embedding_session: Session
        ) -> None:
            """Test embedding multimodal documents with mixed cache hits and misses."""
            cache_embedding = CacheEmbedding(mock_model_instance)
            documents = [
                {"file_id": "cached_file"},
                {"file_id": "new_file_1"},
                {"file_id": "new_file_2"},
            ]

            cached_vector = np.random.randn(1536)
            normalized_cached = (cached_vector / np.linalg.norm(cached_vector)).tolist()

            _cached_embedding_persist_embedding(embedding_session, cache_key="cached_file", vector=normalized_cached)

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

            mock_model_instance.invoke_multimodal_embedding.return_value = embedding_result

            result = cache_embedding.embed_multimodal_documents(documents)

            assert len(result) == 3
            assert result[0] == normalized_cached
            assert embedding_session.scalar(select(func.count()).select_from(Embedding)) == 3

        def test_embed_multimodal_documents_nan_handling(
            self,
            mock_model_instance: Mock,
            embedding_session: Session,
            caplog: pytest.LogCaptureFixture,
        ) -> None:
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

            mock_model_instance.invoke_multimodal_embedding.return_value = embedding_result

            with caplog.at_level(logging.WARNING, logger="core.rag.embedding.cached_embedding"):
                result = cache_embedding.embed_multimodal_documents(documents)

            assert len(result) == 2
            assert result[0] is not None
            assert result[1] is None
            assert embedding_session.scalar(select(func.count()).select_from(Embedding)) == 1

            assert any(record.levelno == logging.WARNING for record in caplog.records)

        def test_embed_multimodal_documents_large_batch(
            self, mock_model_instance: Mock, embedding_session: Session
        ) -> None:
            """Test embedding large batch of multimodal documents respecting MAX_CHUNKS."""
            cache_embedding = CacheEmbedding(mock_model_instance)
            documents = [{"file_id": f"file{i}"} for i in range(25)]

            def create_batch_result(batch_size: int) -> EmbeddingResult:
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

            batch_results = [create_batch_result(10), create_batch_result(10), create_batch_result(5)]
            mock_model_instance.invoke_multimodal_embedding.side_effect = batch_results

            result = cache_embedding.embed_multimodal_documents(documents)

            assert len(result) == 25
            assert mock_model_instance.invoke_multimodal_embedding.call_count == 3
            assert embedding_session.scalar(select(func.count()).select_from(Embedding)) == 25

        def test_embed_multimodal_documents_api_error(
            self, mock_model_instance: Mock, embedding_session: Session
        ) -> None:
            """Test handling of API errors during multimodal embedding."""
            cache_embedding = CacheEmbedding(mock_model_instance)
            documents = [{"file_id": "file123"}]

            mock_model_instance.invoke_multimodal_embedding.side_effect = Exception("API Error")

            with pytest.raises(Exception, match="API Error"):
                cache_embedding.embed_multimodal_documents(documents)

            assert not embedding_session.in_transaction()
            assert embedding_session.scalar(select(func.count()).select_from(Embedding)) == 0

        def test_embed_multimodal_documents_integrity_error_during_transform(
            self,
            mock_model_instance: Mock,
            sample_multimodal_result: EmbeddingResult,
            embedding_session: Session,
        ) -> None:
            """Test handling of IntegrityError during embedding transformation."""
            cache_embedding = CacheEmbedding(mock_model_instance)
            documents = [{"file_id": "file123"}]

            mock_model_instance.invoke_multimodal_embedding.return_value = sample_multimodal_result

            injected = False

            def add_competing_row(session: Session, _flush_context: object, _instances: object) -> None:
                nonlocal injected
                if injected:
                    return
                pending = next(item for item in session.new if isinstance(item, Embedding))
                session.add(
                    Embedding(
                        model_name=pending.model_name,
                        hash=pending.hash,
                        provider_name=pending.provider_name,
                        embedding=pending.embedding,
                    )
                )
                injected = True

            event.listen(embedding_session, "before_flush", add_competing_row)
            try:
                result = cache_embedding.embed_multimodal_documents(documents)
            finally:
                event.remove(embedding_session, "before_flush", add_competing_row)

            assert len(result) == 1
            assert not embedding_session.in_transaction()
            assert embedding_session.scalar(select(func.count()).select_from(Embedding)) == 0

    class TestCacheEmbeddingMultimodalQuery:
        """Test suite for CacheEmbedding.embed_multimodal_query method."""

        @pytest.fixture
        def mock_model_instance(self) -> Mock:
            """Create a mock ModelInstance for testing."""
            model_instance = Mock()
            model_instance.model = "vision-embedding-model"
            model_instance.model_name = "vision-embedding-model"
            model_instance.provider = "openai"
            model_instance.credentials = {"api_key": "test-key"}
            return model_instance

        def test_embed_multimodal_query_cache_miss(self, mock_model_instance: Mock) -> None:
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

        def test_embed_multimodal_query_cache_hit(self, mock_model_instance: Mock) -> None:
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

        def test_embed_multimodal_query_nan_handling(self, mock_model_instance: Mock) -> None:
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

                with pytest.raises(ValueError, match="Normalized embedding is nan please try again") as exc_info:
                    cache_embedding.embed_multimodal_query(document)

                assert "Normalized embedding is nan" in str(exc_info.value)

        def test_embed_multimodal_query_api_error(
            self, mock_model_instance: Mock, config_overrides: Callable[..., None]
        ) -> None:
            """Test handling of API errors during multimodal query embedding."""
            config_overrides(DEBUG=False)
            cache_embedding = CacheEmbedding(mock_model_instance)
            document = {"file_id": "file123"}

            with patch("core.rag.embedding.cached_embedding.redis_client") as mock_redis:
                mock_redis.get.return_value = None
                mock_model_instance.invoke_multimodal_embedding.side_effect = Exception("API Error")

                with pytest.raises(Exception, match="API Error") as exc_info:
                    cache_embedding.embed_multimodal_query(document)

                assert "API Error" in str(exc_info.value)

        def test_embed_multimodal_query_redis_set_error(
            self, mock_model_instance: Mock, config_overrides: Callable[..., None]
        ) -> None:
            """Test handling of Redis set errors during multimodal query embedding."""
            config_overrides(DEBUG=True)
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

                with pytest.raises(RuntimeError):
                    cache_embedding.embed_multimodal_query(document)

    class TestCacheEmbeddingQueryErrors:
        """Test suite for error handling in CacheEmbedding.embed_query method."""

        @pytest.fixture
        def mock_model_instance(self) -> Mock:
            """Create a mock ModelInstance for testing."""
            model_instance = Mock()
            model_instance.model = "text-embedding-ada-002"
            model_instance.model_name = "text-embedding-ada-002"
            model_instance.provider = "openai"
            model_instance.credentials = {"api_key": "test-key"}
            return model_instance

        def test_embed_query_api_error_debug_mode(
            self, mock_model_instance: Mock, caplog: pytest.LogCaptureFixture, config_overrides: Callable[..., None]
        ) -> None:
            """Test handling of API errors in debug mode."""
            config_overrides(DEBUG=True)
            cache_embedding = CacheEmbedding(mock_model_instance)
            query = "test query"

            with patch("core.rag.embedding.cached_embedding.redis_client") as mock_redis:
                mock_redis.get.return_value = None
                mock_model_instance.invoke_text_embedding.side_effect = RuntimeError("API Error")

                with caplog.at_level(logging.ERROR, logger="core.rag.embedding.cached_embedding"):
                    with pytest.raises(RuntimeError) as exc_info:
                        cache_embedding.embed_query(query)

                    assert "API Error" in str(exc_info.value)
                    assert any(record.levelno == logging.ERROR for record in caplog.records)

        def test_embed_query_redis_set_error_debug_mode(
            self, mock_model_instance: Mock, caplog: pytest.LogCaptureFixture, config_overrides: Callable[..., None]
        ) -> None:
            """Test handling of Redis set errors in debug mode."""
            config_overrides(DEBUG=True)
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

                with caplog.at_level(logging.ERROR, logger="core.rag.embedding.cached_embedding"):
                    with pytest.raises(RuntimeError):
                        cache_embedding.embed_query(query)

                    assert any(record.levelno == logging.ERROR for record in caplog.records)

    class TestCacheEmbeddingInitialization:
        """Test suite for CacheEmbedding initialization."""

        def test_initialization_sets_model_instance(self) -> None:
            """Test CacheEmbedding initialization stores the provided model instance."""
            model_instance = Mock()
            model_instance.model = "test-model"
            model_instance.model_name = "test-model"
            model_instance.provider = "test-provider"

            cache_embedding = CacheEmbedding(model_instance)

            assert cache_embedding._model_instance == model_instance


"""Behavior-focused tests for :class:`CacheEmbedding`.

Document and multimodal caches are persisted in SQLite so cache hits, misses,
provider isolation, uniqueness races, and rollback behavior exercise real
SQLAlchemy statements. Model providers and Redis remain mocked external I/O.
"""


@dataclass(frozen=True)
class _Database:
    """Expose a real session through the interface used by the cache."""

    session: Session


def _vector(dimension: int = 8, *, offset: float = 0) -> np.ndarray:
    return np.arange(1 + offset, dimension + 1 + offset, dtype=float)


def _result(*vectors: np.ndarray) -> EmbeddingResult:
    return EmbeddingResult(
        model="text-embedding-ada-002",
        embeddings=list(vectors),
        usage=EmbeddingUsage(
            tokens=len(vectors),
            total_tokens=len(vectors),
            unit_price=Decimal("0.0001"),
            price_unit=Decimal(1000),
            total_price=Decimal("0.000001"),
            currency="USD",
            latency=0.1,
        ),
    )


def _embedding_service_persist_embedding(
    session: Session,
    *,
    text: str,
    vector: list[float],
    model_name: str = "text-embedding-ada-002",
    provider_name: str = "openai",
) -> Embedding:
    row = Embedding(
        model_name=model_name,
        hash=helper.generate_text_hash(text),
        provider_name=provider_name,
        embedding=pickle.dumps(vector, protocol=pickle.HIGHEST_PROTOCOL),
    )
    session.add(row)
    session.commit()
    return row


class TestEmbeddingServiceCases:
    @staticmethod
    @pytest.fixture
    def sqlite_embedding_session(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> Session:
        """Bind the shared SQLite session to the document-cache implementation."""

        monkeypatch.setattr(cached_embedding, "db", _Database(sqlite_session))
        return sqlite_session

    @staticmethod
    @pytest.fixture
    def model_instance() -> Mock:
        instance = Mock()
        instance.model_name = "text-embedding-ada-002"
        instance.provider = "openai"
        instance.credentials = {"api_key": "test-key"}
        schema = Mock(model_properties={ModelPropertyKey.MAX_CHUNKS: 10})
        instance.model_type_instance.get_model_schema.return_value = schema
        return instance

    class TestDocumentCache:
        def test_cache_miss_normalizes_and_persists(
            self, sqlite_embedding_session: Session, model_instance: Mock
        ) -> None:
            model_instance.invoke_text_embedding.return_value = _result(_vector())

            result = CacheEmbedding(model_instance).embed_documents(["new text"])

            assert np.linalg.norm(result[0]) == pytest.approx(1.0)
            model_instance.invoke_text_embedding.assert_called_once_with(
                texts=["new text"], input_type=EmbeddingInputType.DOCUMENT
            )
            persisted = sqlite_embedding_session.scalar(select(Embedding))
            assert persisted is not None
            assert persisted.get_embedding() == result[0]

        def test_cache_hit_uses_persisted_vector(self, sqlite_embedding_session: Session, model_instance: Mock) -> None:
            cached_vector = (_vector() / np.linalg.norm(_vector())).tolist()
            row = _embedding_service_persist_embedding(sqlite_embedding_session, text="cached", vector=cached_vector)

            result = CacheEmbedding(model_instance).embed_documents(["cached"])

            assert result == [cached_vector]
            model_instance.invoke_text_embedding.assert_not_called()
            assert sqlite_embedding_session.scalars(select(Embedding)).all() == [row]

        def test_partial_hit_preserves_input_order(
            self, sqlite_embedding_session: Session, model_instance: Mock
        ) -> None:
            cached_vector = (_vector(offset=10) / np.linalg.norm(_vector(offset=10))).tolist()
            _embedding_service_persist_embedding(sqlite_embedding_session, text="cached", vector=cached_vector)
            model_instance.invoke_text_embedding.return_value = _result(_vector(), _vector(offset=20))

            result = CacheEmbedding(model_instance).embed_documents(["cached", "new one", "new two"])

            assert result[0] == cached_vector
            assert all(np.linalg.norm(vector) == pytest.approx(1.0) for vector in result)
            assert model_instance.invoke_text_embedding.call_args.kwargs["texts"] == ["new one", "new two"]
            assert len(sqlite_embedding_session.scalars(select(Embedding)).all()) == 3

        def test_large_batch_respects_model_chunk_limit(
            self, sqlite_embedding_session: Session, model_instance: Mock
        ) -> None:
            texts = [f"text-{index}" for index in range(25)]
            model_instance.invoke_text_embedding.side_effect = [
                _result(*(_vector(offset=index) for index in range(10))),
                _result(*(_vector(offset=index) for index in range(10, 20))),
                _result(*(_vector(offset=index) for index in range(20, 25))),
            ]

            result = CacheEmbedding(model_instance).embed_documents(texts)

            assert len(result) == 25
            assert [len(call.kwargs["texts"]) for call in model_instance.invoke_text_embedding.call_args_list] == [
                10,
                10,
                5,
            ]
            assert len(sqlite_embedding_session.scalars(select(Embedding)).all()) == 25

        @pytest.mark.parametrize(
            "provider_error",
            [InvokeConnectionError("offline"), InvokeRateLimitError("limited"), InvokeAuthorizationError("denied")],
        )
        def test_provider_error_rolls_back_real_transaction(
            self,
            sqlite_embedding_session: Session,
            model_instance: Mock,
            provider_error: Exception,
        ) -> None:
            model_instance.invoke_text_embedding.side_effect = provider_error

            with pytest.raises(type(provider_error)):
                CacheEmbedding(model_instance).embed_documents(["failure"])

            assert not sqlite_embedding_session.in_transaction()
            assert sqlite_embedding_session.scalar(select(Embedding)) is None

        def test_integrity_race_rolls_back_without_losing_result(
            self, sqlite_embedding_session: Session, model_instance: Mock
        ) -> None:
            model_instance.invoke_text_embedding.return_value = _result(_vector())

            def raise_integrity_error(_session: Session) -> None:
                raise IntegrityError("duplicate embedding", {}, RuntimeError("unique constraint"))

            event.listen(sqlite_embedding_session, "before_commit", raise_integrity_error)
            try:
                result = CacheEmbedding(model_instance).embed_documents(["racing insert"])
            finally:
                event.remove(sqlite_embedding_session, "before_commit", raise_integrity_error)

            assert np.linalg.norm(result[0]) == pytest.approx(1.0)
            assert not sqlite_embedding_session.in_transaction()
            assert sqlite_embedding_session.scalar(select(Embedding)) is None

        def test_nan_vector_is_skipped_and_logged(
            self,
            sqlite_embedding_session: Session,
            model_instance: Mock,
            caplog: pytest.LogCaptureFixture,
        ) -> None:
            model_instance.invoke_text_embedding.return_value = _result(np.array([np.nan, 1.0]))

            with caplog.at_level("WARNING", logger="core.rag.embedding.cached_embedding"):
                result = CacheEmbedding(model_instance).embed_documents(["invalid"])

            assert result == [None]
            assert "Normalized embedding is nan" in caplog.text
            assert sqlite_embedding_session.scalar(select(Embedding)) is None

        def test_duplicate_text_is_cached_once(self, sqlite_embedding_session: Session, model_instance: Mock) -> None:
            model_instance.invoke_text_embedding.return_value = _result(_vector(), _vector())

            result = CacheEmbedding(model_instance).embed_documents(["same", "same"])

            assert result[0] == result[1]
            assert len(sqlite_embedding_session.scalars(select(Embedding)).all()) == 1

        def test_provider_and_model_are_part_of_cache_identity(self, sqlite_embedding_session: Session) -> None:
            first = Mock(model_name="shared-model", provider="provider-a", credentials={})
            first.model_type_instance.get_model_schema.return_value = Mock(
                model_properties={ModelPropertyKey.MAX_CHUNKS: 10}
            )
            first.invoke_text_embedding.return_value = _result(_vector())
            second = Mock(model_name="shared-model", provider="provider-b", credentials={})
            second.model_type_instance.get_model_schema.return_value = Mock(
                model_properties={ModelPropertyKey.MAX_CHUNKS: 10}
            )
            second.invoke_text_embedding.return_value = _result(_vector(offset=10))

            first_result = CacheEmbedding(first).embed_documents(["same text"])
            second_result = CacheEmbedding(second).embed_documents(["same text"])

            assert first_result != second_result
            assert len(sqlite_embedding_session.scalars(select(Embedding)).all()) == 2

        def test_empty_input_does_not_touch_provider(self, model_instance: Mock) -> None:
            assert CacheEmbedding(model_instance).embed_documents([]) == []
            model_instance.invoke_text_embedding.assert_not_called()

    class TestMultimodalDocumentCache:
        def test_multimodal_miss_persists_and_hit_reuses(
            self, sqlite_embedding_session: Session, model_instance: Mock
        ) -> None:
            document = {"file_id": "file-1"}
            model_instance.invoke_multimodal_embedding.return_value = _result(_vector())
            cache = CacheEmbedding(model_instance)

            generated = cache.embed_multimodal_documents([document])
            cached = cache.embed_multimodal_documents([document])

            assert cached == generated
            model_instance.invoke_multimodal_embedding.assert_called_once_with(
                multimodel_documents=[document], input_type=EmbeddingInputType.DOCUMENT
            )
            assert sqlite_embedding_session.scalar(select(Embedding).where(Embedding.hash == "file-1")) is not None

    class TestQueryCache:
        @patch("core.rag.embedding.cached_embedding.redis_client")
        def test_cached_query_can_be_read_without_model_instance(self, redis: Mock) -> None:
            vector = np.array([0.25, 0.75], dtype=float)
            redis.get.return_value = base64.b64encode(vector.tobytes())

            result = CacheEmbedding.get_cached_query_embedding("openai", "text-embedding-ada-002", "query")

            assert result == vector.tolist()
            redis.get.assert_called_once_with(f"openai_text-embedding-ada-002_{helper.generate_text_hash('query')}")
            redis.expire.assert_called_once_with(
                f"openai_text-embedding-ada-002_{helper.generate_text_hash('query')}", 600
            )

        @patch("core.rag.embedding.cached_embedding.redis_client")
        def test_query_cache_miss_normalizes_and_stores(self, redis: Mock, model_instance: Mock) -> None:
            redis.get.return_value = None
            model_instance.invoke_text_embedding.return_value = _result(_vector())

            result = CacheEmbedding(model_instance).embed_query("query")

            assert np.linalg.norm(result) == pytest.approx(1.0)
            model_instance.invoke_text_embedding.assert_called_once_with(
                texts=["query"], input_type=EmbeddingInputType.QUERY
            )
            redis.setex.assert_called_once()

        @patch("core.rag.embedding.cached_embedding.redis_client")
        def test_query_cache_hit_refreshes_ttl(self, redis: Mock, model_instance: Mock) -> None:
            vector = np.array([0.25, 0.75], dtype=float)
            redis.get.return_value = base64.b64encode(vector.tobytes())

            result = CacheEmbedding(model_instance).embed_query("query")

            assert result == vector.tolist()
            redis.expire.assert_called_once_with(
                f"openai_text-embedding-ada-002_{helper.generate_text_hash('query')}", 600
            )
            model_instance.invoke_text_embedding.assert_not_called()

        @patch("core.rag.embedding.cached_embedding.redis_client")
        def test_query_nan_is_rejected(self, redis: Mock, model_instance: Mock) -> None:
            redis.get.return_value = None
            model_instance.invoke_text_embedding.return_value = _result(np.array([np.nan, 1.0]))

            with pytest.raises(ValueError, match="Normalized embedding is nan"):
                CacheEmbedding(model_instance).embed_query("query")

            redis.setex.assert_not_called()

        @patch("core.rag.embedding.cached_embedding.redis_client")
        def test_redis_write_error_is_propagated(self, redis: Mock, model_instance: Mock) -> None:
            redis.get.return_value = None
            redis.setex.side_effect = ConnectionError("redis unavailable")
            model_instance.invoke_text_embedding.return_value = _result(_vector())

            with pytest.raises(ConnectionError, match="redis unavailable"):
                CacheEmbedding(model_instance).embed_query("query")

        @patch("core.rag.embedding.cached_embedding.redis_client")
        def test_multimodal_query_uses_file_cache_key(self, redis: Mock, model_instance: Mock) -> None:
            redis.get.return_value = None
            model_instance.invoke_multimodal_embedding.return_value = _result(_vector())

            result = CacheEmbedding(model_instance).embed_multimodal_query({"file_id": "file-1"})

            assert np.linalg.norm(result) == pytest.approx(1.0)
            assert redis.setex.call_args.args[:2] == ("openai_text-embedding-ada-002_file-1", 600)
