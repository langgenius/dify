"""Behavior-focused tests for :class:`CacheEmbedding`.

Document and multimodal caches are persisted in SQLite so cache hits, misses,
provider isolation, uniqueness races, and rollback behavior exercise real
SQLAlchemy statements. Model providers and Redis remain mocked external I/O.
"""

import base64
import pickle
from collections.abc import Iterator
from dataclasses import dataclass
from decimal import Decimal
from unittest.mock import Mock, patch

import numpy as np
import pytest
from sqlalchemy import event, select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.entities.embedding_type import EmbeddingInputType
from core.rag.embedding import cached_embedding
from core.rag.embedding.cached_embedding import CacheEmbedding
from graphon.model_runtime.entities.model_entities import ModelPropertyKey
from graphon.model_runtime.entities.text_embedding_entities import EmbeddingResult, EmbeddingUsage
from graphon.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeConnectionError,
    InvokeRateLimitError,
)
from libs import helper
from models.base import TypeBase
from models.dataset import Embedding


@dataclass(frozen=True)
class _Database:
    """Expose a real session through the interface used by the cache."""

    session: Session


@pytest.fixture
def sqlite_embedding_session(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[Session]:
    """Bind one explicit SQLite session to the document-cache implementation."""

    TypeBase.metadata.create_all(sqlite_engine, tables=[Embedding.__table__])
    with Session(sqlite_engine, expire_on_commit=False) as session:
        monkeypatch.setattr(cached_embedding, "db", _Database(session))
        yield session


@pytest.fixture
def model_instance() -> Mock:
    instance = Mock()
    instance.model_name = "text-embedding-ada-002"
    instance.provider = "openai"
    instance.credentials = {"api_key": "test-key"}
    schema = Mock(model_properties={ModelPropertyKey.MAX_CHUNKS: 10})
    instance.model_type_instance.get_model_schema.return_value = schema
    return instance


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


def _persist_embedding(
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


class TestDocumentCache:
    def test_cache_miss_normalizes_and_persists(self, sqlite_embedding_session: Session, model_instance: Mock) -> None:
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
        row = _persist_embedding(sqlite_embedding_session, text="cached", vector=cached_vector)

        result = CacheEmbedding(model_instance).embed_documents(["cached"])

        assert result == [cached_vector]
        model_instance.invoke_text_embedding.assert_not_called()
        assert sqlite_embedding_session.scalars(select(Embedding)).all() == [row]

    def test_partial_hit_preserves_input_order(self, sqlite_embedding_session: Session, model_instance: Mock) -> None:
        cached_vector = (_vector(offset=10) / np.linalg.norm(_vector(offset=10))).tolist()
        _persist_embedding(sqlite_embedding_session, text="cached", vector=cached_vector)
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

    def test_empty_input_does_not_touch_provider(self, sqlite_embedding_session: Session, model_instance: Mock) -> None:
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
        redis.expire.assert_called_once_with(f"openai_text-embedding-ada-002_{helper.generate_text_hash('query')}", 600)
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
