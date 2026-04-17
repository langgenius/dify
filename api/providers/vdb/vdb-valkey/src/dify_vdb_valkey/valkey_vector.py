"""Valkey vector store backend using valkey-glide and the valkey-search module.

This module implements the Dify vector store interface for Valkey, using the
``valkey-search`` module's ``FT.CREATE`` / ``FT.SEARCH`` / ``FT.DROPINDEX`` commands
for vector similarity search and full-text search.

Data is stored as Valkey HASH keys. Each document gets a hash key containing:
- ``vector``: the embedding as raw FLOAT32 bytes
- ``page_content``: the document text
- ``metadata``: JSON-serialised metadata dict
- ``group_id``: the dataset/group identifier

An FT index is created per collection with HNSW vector indexing, TAG fields
for ``group_id`` / ``doc_id`` / ``document_id``, and a TEXT field for
``page_content`` to support full-text search.

Dimensions are auto-detected from the first embedding on index creation.
The distance metric (COSINE, L2, IP) is configurable via ``VALKEY_DISTANCE_METRIC``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import struct
import uuid
from typing import Any, Literal

from pydantic import BaseModel

from configs import dify_config
from core.rag.datasource.vdb.field import Field
from core.rag.datasource.vdb.vector_base import BaseVector, VectorIndexStructDict
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document

# ``redis_client`` is Dify's internal Redis instance (used for caching and
# Celery).  It is **not** the Valkey vector store — it is only used here for
# distributed locking during index creation so that concurrent workers don't
# race to create the same FT index.
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)

# Distance metrics supported by valkey-search.
DistanceMetric = Literal["COSINE", "L2", "IP"]
_VALID_DISTANCE_METRICS: frozenset[str] = frozenset({"COSINE", "L2", "IP"})


# ---------------------------------------------------------------------------
# Pure helpers — no external dependencies, safe to unit-test directly.
# ---------------------------------------------------------------------------


def _float_vector_to_bytes(vector: list[float]) -> bytes:
    """Pack a list of floats into little-endian FLOAT32 bytes for Valkey."""
    return struct.pack(f"<{len(vector)}f", *vector)


def _bytes_to_float_vector(data: bytes) -> list[float]:
    """Unpack little-endian FLOAT32 bytes back into a list of floats."""
    count = len(data) // 4
    return list(struct.unpack(f"<{count}f", data))


def _to_str(value: Any) -> str:
    """Convert bytes or str to str."""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value) if value is not None else ""


def _escape_tag(value: str) -> str:
    """Escape special characters in a TAG value for FT.SEARCH queries."""
    special = r"\.+*?[{()|^$!<>~@&\"-]"
    result: list[str] = []
    for ch in value:
        if ch in special:
            result.append(f"\\{ch}")
        else:
            result.append(ch)
    return "".join(result)


def _escape_text(value: str) -> str:
    """Escape special characters in a TEXT query for FT.SEARCH."""
    special = r"@!{}()|-=>~*\'\""
    result: list[str] = []
    for ch in value:
        if ch in special:
            result.append(f"\\{ch}")
        else:
            result.append(ch)
    return "".join(result)


def _parse_dict_keys(result: Any) -> list[str]:
    """Parse key names from a glide FT.SEARCH ``RETURN 0`` response.

    Glide returns ``[total_count, {key: {}, ...}]``.
    """
    if not result or not isinstance(result, (list, tuple)) or len(result) < 2:
        return []
    entries = result[1]
    if not isinstance(entries, dict):
        return []
    return [_to_str(k) for k in entries]


def _distance_to_similarity(distance: float, metric: str) -> float:
    """Convert a valkey-search distance value to a [0, 1] similarity score.

    Valkey-search distance definitions (per the FT.CREATE docs):
    - COSINE: ``1 - cos(θ)``, range [0, 2].  Similarity = ``1 - d/2``.
    - L2:     Euclidean distance, range [0, ∞).  Similarity = ``1 / (1 + d)``.
    - IP:     ``1 - dot(X, Y)``.  Similarity = ``1 - d`` (already normalised
              when vectors are unit-length).
    """
    metric_upper = metric.upper()
    if metric_upper == "COSINE":
        return 1.0 - distance / 2.0
    if metric_upper == "L2":
        return 1.0 / (1.0 + distance)
    if metric_upper == "IP":
        return 1.0 - distance
    raise ValueError(f"Unsupported distance metric: {metric!r}. Must be one of: COSINE, L2, IP.")


def _parse_vector_search_results(
    result: Any,
    score_threshold: float,
    distance_metric: str,
) -> list[Document]:
    """Parse FT.SEARCH results from a vector KNN query.

    The glide client returns ``[total_count, {key: {field: value, ...}, ...}]``.
    The ``__vector_score`` field contains the raw distance.
    """
    if not result or not isinstance(result, (list, tuple)) or len(result) < 2:
        return []

    entries = result[1]
    if not isinstance(entries, dict):
        return []

    docs: list[Document] = []
    for _key, fields in entries.items():
        if not isinstance(fields, dict):
            continue

        score_raw = fields.get(b"__vector_score") or fields.get("__vector_score")
        if score_raw is None:
            continue
        distance = float(_to_str(score_raw))
        score = _distance_to_similarity(distance, distance_metric)

        if score < score_threshold:
            continue

        metadata_raw = fields.get(b"metadata") or fields.get(Field.METADATA_KEY, b"{}")
        metadata = json.loads(_to_str(metadata_raw)) if metadata_raw else {}
        metadata["score"] = score

        page_content = _to_str(fields.get(b"page_content") or fields.get(Field.CONTENT_KEY, b""))
        docs.append(Document(page_content=page_content, metadata=metadata))

    docs.sort(key=lambda d: d.metadata.get("score", 0) if d.metadata else 0, reverse=True)
    return docs


def _parse_full_text_results(result: Any) -> list[tuple[str, Document]]:
    """Parse FT.SEARCH results from a full-text query.

    Returns a list of ``(key_name, Document)`` tuples.
    """
    if not result or not isinstance(result, (list, tuple)) or len(result) < 2:
        return []

    entries = result[1]
    if not isinstance(entries, dict):
        return []

    pairs: list[tuple[str, Document]] = []
    for key_raw, fields in entries.items():
        if not isinstance(fields, dict):
            continue

        key = _to_str(key_raw)
        metadata_raw = fields.get(b"metadata") or fields.get(Field.METADATA_KEY, b"{}")
        metadata = json.loads(_to_str(metadata_raw)) if metadata_raw else {}
        page_content = _to_str(fields.get(b"page_content") or fields.get(Field.CONTENT_KEY, b""))
        pairs.append((key, Document(page_content=page_content, metadata=metadata)))

    return pairs


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


class ValkeyVectorConfig(BaseModel):
    """Connection parameters for the Valkey server."""

    host: str = "localhost"
    port: int = 6379
    password: str = ""
    db: int = 0
    use_ssl: bool = False
    distance_metric: DistanceMetric = "COSINE"


# ---------------------------------------------------------------------------
# Async client helper
# ---------------------------------------------------------------------------

# The glide client is bound to the event loop it was created on.  We keep a
# dedicated loop per ValkeyVector instance so every ``_run`` call dispatches
# on the correct loop.


def _create_glide_client(config: ValkeyVectorConfig) -> tuple[Any, asyncio.AbstractEventLoop]:
    """Create a valkey-glide ``GlideClient`` and the event loop it lives on.

    Returns ``(client, loop)``.  Callers must use ``loop.run_until_complete``
    for all subsequent async operations on *client*.
    """
    from glide import GlideClient, GlideClientConfiguration, NodeAddress

    addresses = [NodeAddress(config.host, config.port)]
    kwargs: dict[str, Any] = {
        "addresses": addresses,
        "use_tls": config.use_ssl,
        "request_timeout": 30_000,
    }
    if config.password:
        from glide import ServerCredentials

        kwargs["credentials"] = ServerCredentials(password=config.password)

    glide_config = GlideClientConfiguration(**kwargs)
    if config.db:
        glide_config.database_id = config.db

    loop = asyncio.new_event_loop()
    client = loop.run_until_complete(GlideClient.create(glide_config))
    return client, loop


# ---------------------------------------------------------------------------
# ValkeyVector
# ---------------------------------------------------------------------------


class ValkeyVector(BaseVector):
    """Valkey vector store implementation using the valkey-search module."""

    _config: ValkeyVectorConfig
    _client: Any
    _loop: asyncio.AbstractEventLoop
    _group_id: str
    _prefix: str

    def __init__(
        self,
        collection_name: str,
        group_id: str,
        config: ValkeyVectorConfig,
        *,
        client: Any | None = None,
        loop: asyncio.AbstractEventLoop | None = None,
    ) -> None:
        super().__init__(collection_name)
        self._config = config
        self._group_id = group_id
        self._prefix = f"doc:{collection_name}:"
        if client is not None:
            self._client = client
            self._loop = loop or asyncio.new_event_loop()
        else:
            self._client, self._loop = _create_glide_client(config)

    def _run(self, coro: Any) -> Any:
        """Run an async coroutine on this instance's event loop."""
        return self._loop.run_until_complete(coro)

    def close(self) -> None:
        """Shut down the glide client and close the event loop."""
        try:
            self._run(self._client.close())
        except Exception:
            logger.debug("Error closing glide client", exc_info=True)
        finally:
            if not self._loop.is_closed():
                self._loop.close()

    def __enter__(self) -> ValkeyVector:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def __del__(self) -> None:
        # Best-effort cleanup if close() was never called explicitly.
        try:
            if not self._loop.is_closed():
                self.close()
        except Exception:
            logger.debug("Error during __del__ cleanup", exc_info=True)
        finally:
            # Ensure the loop is closed even if close() failed.
            try:
                if not self._loop.is_closed():
                    self._loop.close()
            except Exception:
                pass

    def get_type(self) -> str:
        return VectorType.VALKEY

    def to_index_struct(self) -> VectorIndexStructDict:
        return {
            "type": self.get_type(),
            "vector_store": {"class_prefix": self._collection_name},
        }

    # ------------------------------------------------------------------
    # Index management
    # ------------------------------------------------------------------

    def _index_name(self) -> str:
        return f"idx:{self._collection_name}"

    def _index_exists(self) -> bool:
        """Check whether the FT index already exists."""
        from glide.async_commands.server_modules import ft

        try:
            self._run(ft.info(self._client, self._index_name()))
            return True
        except Exception:
            return False

    def _create_index(self, vector_size: int) -> None:
        """Create the FT index with HNSW vector, TAG, and TEXT fields.

        The distance metric is read from ``self._config.distance_metric``.
        Dimensions are determined by *vector_size* (auto-detected from the
        first embedding passed to ``create``).
        """
        from glide.async_commands.server_modules import ft
        from glide.async_commands.server_modules.ft_options.ft_create_options import (
            DistanceMetricType,
            FtCreateOptions,
            TagField,
            TextField,
            VectorAlgorithm,
            VectorField,
            VectorFieldAttributesHnsw,
        )
        from glide.async_commands.server_modules.ft_options.ft_create_options import (
            VectorType as GlideVectorType,
        )

        metric_map = {
            "COSINE": DistanceMetricType.COSINE,
            "L2": DistanceMetricType.L2,
            "IP": DistanceMetricType.IP,
        }
        metric = metric_map.get(
            self._config.distance_metric.upper(),
            DistanceMetricType.COSINE,
        )

        schema = [
            VectorField(
                name="vector",
                algorithm=VectorAlgorithm.HNSW,
                attributes=VectorFieldAttributesHnsw(
                    dimensions=vector_size,
                    distance_metric=metric,
                    type=GlideVectorType.FLOAT32,
                ),
            ),
            TagField(name="group_id"),
            TagField(name="doc_id"),
            TagField(name="document_id"),
            TextField(name=Field.CONTENT_KEY),
        ]
        options = FtCreateOptions(prefixes=[self._prefix])
        self._run(ft.create(self._client, self._index_name(), schema, options))

    # ------------------------------------------------------------------
    # CRUD operations
    # ------------------------------------------------------------------

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs: Any) -> None:
        if not texts or not embeddings:
            return
        if len(texts) != len(embeddings):
            raise ValueError(f"Number of documents ({len(texts)}) must match number of embeddings ({len(embeddings)})")
        vector_size = len(embeddings[0])
        if vector_size == 0:
            raise ValueError("First embedding is empty — cannot determine vector dimensions")
        lock_name = f"vector_indexing_lock_{self._collection_name}"
        with redis_client.lock(lock_name, timeout=20):
            cache_key = f"vector_indexing_{self._collection_name}"
            if not redis_client.get(cache_key):
                if not self._index_exists():
                    self._create_index(vector_size)
                redis_client.set(cache_key, 1, ex=3600)
        self.add_texts(texts, embeddings, **kwargs)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs: Any) -> list[str]:
        if not documents:
            return []
        if len(documents) != len(embeddings):
            raise ValueError(
                f"Number of documents ({len(documents)}) must match number of embeddings ({len(embeddings)})"
            )

        # Validate all embeddings have consistent dimensions.
        expected_dim = len(embeddings[0])
        for i, emb in enumerate(embeddings):
            if len(emb) != expected_dim:
                raise ValueError(f"Embedding dimension mismatch at index {i}: expected {expected_dim}, got {len(emb)}")

        added_ids: list[str] = []
        for doc, embedding in zip(documents, embeddings):
            metadata = dict(doc.metadata or {})
            doc_id = metadata.get("doc_id") or str(uuid.uuid4())
            metadata["doc_id"] = doc_id
            key = f"{self._prefix}{doc_id}"
            fields: dict[str, str | bytes] = {
                "vector": _float_vector_to_bytes(embedding),
                Field.CONTENT_KEY: doc.page_content,
                Field.METADATA_KEY: json.dumps(metadata),
                "group_id": self._group_id,
                "doc_id": doc_id,
                "document_id": metadata.get("document_id", ""),
            }
            try:
                self._run(self._client.hset(key, fields))
            except Exception:
                logger.exception(
                    "Failed to add document %s to collection %s",
                    doc_id,
                    self._collection_name,
                )
                raise
            added_ids.append(doc_id)

        return added_ids

    def text_exists(self, id: str) -> bool:
        key = f"{self._prefix}{id}"
        result = self._run(self._client.exists([key]))
        return result > 0

    def delete_by_ids(self, ids: list[str]) -> None:
        if not ids:
            return
        keys = [f"{self._prefix}{doc_id}" for doc_id in ids]
        self._run(self._client.delete(keys))

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        """Delete documents matching a supported metadata TAG field value."""
        supported_keys = {"document_id", "doc_id"}
        if key not in supported_keys:
            raise ValueError(
                f"Unsupported metadata field for deletion: {key!r}. "
                f"Supported fields are: {', '.join(sorted(supported_keys))}."
            )
        query = f"@{key}:{{{_escape_tag(value)}}}"
        self._delete_by_query(query)

    def delete(self) -> None:
        """Delete all documents belonging to this group."""
        query = f"@group_id:{{{_escape_tag(self._group_id)}}}"
        self._delete_by_query(query)

    def _delete_by_query(self, query: str) -> None:
        """Search for keys matching *query* and delete them."""
        from glide.async_commands.server_modules import ft
        from glide.async_commands.server_modules.ft_options.ft_search_options import (
            FtSearchLimit,
            FtSearchOptions,
        )

        batch_size = 100
        while True:
            # Always search from offset 0 because deletions shift the result set.
            options = FtSearchOptions(
                return_fields=[],
                limit=FtSearchLimit(offset=0, count=batch_size),
            )
            result = self._run(
                ft.search(self._client, self._index_name(), query, options),
            )
            keys = _parse_dict_keys(result)
            if not keys:
                break
            self._run(self._client.delete(keys))

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        from glide.async_commands.server_modules import ft
        from glide.async_commands.server_modules.ft_options.ft_search_options import (
            FtSearchLimit,
            FtSearchOptions,
        )

        top_k = kwargs.get("top_k", 4)
        score_threshold = float(kwargs.get("score_threshold") or 0.0)

        query = f"(@group_id:{{{_escape_tag(self._group_id)}}})=>[KNN {top_k} @vector $query_vector]"

        document_ids_filter = kwargs.get("document_ids_filter")
        if document_ids_filter:
            tag_values = "|".join(_escape_tag(did) for did in document_ids_filter)
            query = (
                f"(@group_id:{{{_escape_tag(self._group_id)}}} "
                f"@document_id:{{{tag_values}}})"
                f"=>[KNN {top_k} @vector $query_vector]"
            )

        vector_bytes = _float_vector_to_bytes(query_vector)
        options = FtSearchOptions(
            params={"query_vector": vector_bytes},
            limit=FtSearchLimit(offset=0, count=top_k),
        )
        result = self._run(
            ft.search(self._client, self._index_name(), query, options),
        )
        return _parse_vector_search_results(
            result,
            score_threshold,
            self._config.distance_metric,
        )

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        """Full-text search on ``page_content``.

        Splits the query into keywords and searches each separately (OR logic),
        deduplicating results by key name.
        """
        from glide.async_commands.server_modules import ft
        from glide.async_commands.server_modules.ft_options.ft_search_options import (
            FtSearchLimit,
            FtSearchOptions,
        )

        top_k = kwargs.get("top_k", 2)
        keywords = list(
            dict.fromkeys(kw.strip() for kw in query.strip().split() if kw.strip()),
        )[:10]
        if not keywords:
            return []

        document_ids_filter = kwargs.get("document_ids_filter")
        seen_keys: set[str] = set()
        documents: list[Document] = []

        for keyword in keywords:
            escaped_kw = _escape_text(keyword)
            filter_parts = [f"@group_id:{{{_escape_tag(self._group_id)}}}"]
            if document_ids_filter:
                tag_values = "|".join(_escape_tag(did) for did in document_ids_filter)
                filter_parts.append(f"@document_id:{{{tag_values}}}")
            filter_parts.append(f"@{Field.CONTENT_KEY}:{escaped_kw}")
            ft_query = " ".join(filter_parts)

            options = FtSearchOptions(limit=FtSearchLimit(offset=0, count=top_k))
            result = self._run(
                ft.search(self._client, self._index_name(), ft_query, options),
            )
            for key, doc in _parse_full_text_results(result):
                if key not in seen_keys:
                    seen_keys.add(key)
                    documents.append(doc)
                    if len(documents) >= top_k:
                        return documents
        return documents


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


class ValkeyVectorFactory(AbstractVectorFactory):
    """Factory for creating ValkeyVector instances from dataset configuration."""

    def init_vector(
        self,
        dataset: Dataset,
        attributes: list,
        embeddings: Embeddings,
    ) -> ValkeyVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)

        if not dataset.index_struct_dict:
            dataset.index_struct = json.dumps(
                self.gen_index_struct_dict(VectorType.VALKEY, collection_name),
            )

        return ValkeyVector(
            collection_name=collection_name,
            group_id=dataset.id,
            config=ValkeyVectorConfig(
                host=dify_config.VALKEY_HOST,
                port=dify_config.VALKEY_PORT,
                password=dify_config.VALKEY_PASSWORD,
                db=dify_config.VALKEY_DB,
                use_ssl=dify_config.VALKEY_USE_SSL,
                distance_metric=dify_config.VALKEY_DISTANCE_METRIC,
            ),
        )
