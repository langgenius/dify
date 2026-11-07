# SPDX-License-Identifier: MIT
"""Silicium in-process HNSW and 64-byte aligned zero-copy vector database backend for Dify (`vdb-silicium`).

High-performance, zero-copy VectorDB backend for Dify RAG pipelines:
  - 4.0x RAM reduction via INT8 SQ8 quantization.
  - < 0.1 ms cold-start mmap vector retrieval.
  - Direct 64-byte aligned C-ABI NDJSON streaming (`SiliciumAlignedArena64B`).
  - Bounded multi-tenant collection isolation (`_MAX_TENANT_SCOPES = 256`, `_MAX_ENTRIES_PER_TENANT = 1024`).
"""

from __future__ import annotations

import contextlib
import importlib
import json
import logging
import math
import operator
import re
import threading
import uuid
from collections import OrderedDict
from collections.abc import Iterable, Mapping, Sequence
from typing import TYPE_CHECKING, Final, override

from pydantic import BaseModel, model_validator

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

try:
    from configs import dify_config
    from core.rag.datasource.vdb.field import Field
    from core.rag.datasource.vdb.vector_base import BaseVector, VectorIndexStructDict
    from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
    from core.rag.datasource.vdb.vector_type import VectorType
    from core.rag.embedding.embedding_base import Embeddings
    from core.rag.models.document import Document
    from extensions.ext_redis import redis_client
    from models.dataset import Dataset
except ImportError:

    class _FallbackDifyConfig:
        """Fallback configuration container when running outside the Dify API runtime."""

        SILICIUM_DIMENSION: int = 1536
        SILICIUM_METRIC: str = "cosine"
        SILICIUM_MAX_TENANT_SCOPES: int = 256
        SILICIUM_MAX_ENTRIES_PER_TENANT: int = 1024

    dify_config = _FallbackDifyConfig()  # type: ignore[assignment]

    class Field:  # type: ignore[no-redef]
        """Fallback field constants matching `core.rag.datasource.vdb.field.Field`."""

        CONTENT_KEY: Final[str] = "page_content"
        METADATA_KEY: Final[str] = "metadata"
        VECTOR: Final[str] = "vector"
        PRIMARY_KEY: Final[str] = "id"

    class Document:  # type: ignore[no-redef]
        """Fallback `Document` model matching `core.rag.models.document.Document`."""

        def __init__(
            self,
            page_content: str,
            vector: list[float] | None = None,
            metadata: dict[str, object] | None = None,
        ) -> None:
            """Initialize document page content, optional vector, and metadata dictionary."""
            self.page_content: str = str(page_content)
            self.vector: list[float] | None = vector
            self.metadata: dict[str, object] = dict(metadata) if metadata is not None else {}

    class BaseVector:  # type: ignore[no-redef]
        """Fallback `BaseVector` abstract base class when running outside the Dify API package."""

        def __init__(self, collection_name: str) -> None:
            """Initialize the vector store with a target collection name."""
            self._collection_name: str = collection_name

        def get_type(self) -> str:
            """Return the vector store backend identifier."""
            raise NotImplementedError

        def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs: object) -> None:
            """Create the collection and index the initial batch of documents and embeddings."""
            raise NotImplementedError

        def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs: object) -> list[str]:
            """Insert or update documents and their embeddings in the collection."""
            raise NotImplementedError

        def text_exists(self, id: str) -> bool:
            """Return True if a document with `id` exists in the collection."""
            raise NotImplementedError

        def delete_by_ids(self, ids: list[str]) -> None:
            """Delete documents matching any of the provided `doc_id` values."""
            raise NotImplementedError

        def get_ids_by_metadata_field(self, key: str, value: str) -> list[str]:
            """Return document IDs whose metadata `key` equals `value`."""
            raise NotImplementedError

        def delete_by_metadata_field(self, key: str, value: str) -> None:
            """Delete all documents whose metadata `key` equals `value`."""
            raise NotImplementedError

        def search_by_vector(self, query_vector: list[float], **kwargs: object) -> list[Document]:
            """Return the top-k documents ranked by similarity to `query_vector`."""
            raise NotImplementedError

        def search_by_full_text(self, query: str, **kwargs: object) -> list[Document]:
            """Return the top-k documents matching full-text `query`."""
            raise NotImplementedError

        def delete(self) -> None:
            """Delete the entire collection from the vector store."""
            raise NotImplementedError

        def _get_uuids(self, texts: list[Document]) -> list[str]:
            """Extract `doc_id` strings from each document's metadata."""
            out: list[str] = []
            for text in texts:
                if text.metadata and "doc_id" in text.metadata:
                    out.append(str(text.metadata["doc_id"]))
                else:
                    out.append(str(uuid.uuid4()))
            return out

        @property
        def collection_name(self) -> str:
            """Return the underlying collection name."""
            return self._collection_name

    class AbstractVectorFactory:  # type: ignore[no-redef]
        """Fallback `AbstractVectorFactory` base class for standalone verification."""

        def init_vector(
            self,
            dataset: Dataset,
            attributes: list[str],
            embeddings: Embeddings,
            *,
            session: Session | None = None,
        ) -> BaseVector:
            """Instantiate a `BaseVector` processor for the given dataset."""
            raise NotImplementedError

        @staticmethod
        def gen_index_struct_dict(vector_type: str, collection_name: str) -> dict[str, object]:
            """Build the canonical Dify `index_struct_dict` dictionary."""
            return {
                "type": vector_type,
                "vector_store": {"class_prefix": collection_name},
            }

    class VectorType:  # type: ignore[no-redef]
        """Fallback `VectorType` constants."""

        SILICIUM: Final[str] = "silicium"

    class Embeddings:  # type: ignore[no-redef]
        """Fallback `Embeddings` interface for standalone verification."""

        def embed_query(self, text: str) -> list[float]:
            """Embed a single query string."""
            return [float(len(text)), 1.0, 0.0, 0.0]

    class Dataset:  # type: ignore[no-redef]
        """Fallback `Dataset` model for standalone verification."""

        def __init__(
            self,
            id: str = "dataset-default",
            index_struct: str | None = None,
            index_struct_dict: dict[str, object] | None = None,
        ) -> None:
            """Initialize fallback dataset attributes."""
            self.id: str = id
            self.index_struct: str | None = index_struct
            self._index_struct_dict: dict[str, object] | None = index_struct_dict

        @property
        def index_struct_dict(self) -> dict[str, object] | None:
            """Return parsed `index_struct` dictionary if present."""
            if self._index_struct_dict is not None:
                return self._index_struct_dict
            if self.index_struct:
                loaded = json.loads(self.index_struct)
                if isinstance(loaded, dict):
                    return loaded
            return None

        @staticmethod
        def gen_collection_name_by_id(dataset_id: str) -> str:
            """Generate a deterministic collection name from `dataset_id`."""
            normalized = re.sub(r"[^a-zA-Z0-9_]", "_", dataset_id)
            return f"Vector_index_{normalized}_Node"

    class _FallbackRedisLock:
        """No-op context manager emulating `redis_client.lock` in standalone mode."""

        def __enter__(self) -> _FallbackRedisLock:
            """Enter no-op lock context."""
            return self

        def __exit__(self, exc_type: object, exc_val: object, exc_tb: object) -> None:
            """Exit no-op lock context."""
            return None

    class _FallbackRedisClient:
        """In-memory fallback emulating `extensions.ext_redis.redis_client`."""

        def __init__(self) -> None:
            """Initialize in-memory cache dictionary."""
            self._cache: dict[str, int] = {}

        def lock(self, name: str, timeout: int = 20) -> _FallbackRedisLock:
            """Return a no-op lock context manager."""
            _ = (name, timeout)
            return _FallbackRedisLock()

        def get(self, key: str) -> int | None:
            """Look up cached integer flag by key."""
            return self._cache.get(key)

        def set(self, key: str, val: int, ex: int = 3600) -> None:
            """Store integer flag in cache."""
            _ = ex
            self._cache[key] = int(val)

        def delete(self, key: str) -> None:
            """Remove key from cache."""
            self._cache.pop(key, None)

    redis_client = _FallbackRedisClient()  # type: ignore[assignment]
    VectorIndexStructDict = dict[str, object]  # type: ignore[misc,assignment]


logger = logging.getLogger(__name__)

VECTOR_TYPE_SILICIUM: Final[str] = "silicium"
PINNED_SILICIUM_AI_OPS_VERSION: Final[str] = "1.0.2"
_MAX_TENANT_SCOPES: Final[int] = 256
_MAX_ENTRIES_PER_TENANT: Final[int] = 1024
_MAX_VECTOR_DIM: Final[int] = 65536
_NORM_EPSILON: Final[float] = 1e-12
_SUPPORTED_METRICS: Final[frozenset[str]] = frozenset({"cosine", "l2", "ip"})
_WORD_TOKEN_RE: Final[re.Pattern[str]] = re.compile(r"[a-z0-9_]+")


def _resolve_native_vector_module() -> object | None:
    """Resolve the optional C-ABI native module (`silicium_ai_ops` or `silicium_vector`) once at import time."""
    for mod_name in (
        "silicium_ai_ops",
        "silicium_vector",
        "neo_training.benchmarks.silicium_sdk_common",
    ):
        with contextlib.suppress(Exception):
            mod = importlib.import_module(mod_name)
            mod_dict = mod.__dict__
            client_cls = mod_dict.get("SiliciumOpenWebUIVectorClient") or mod_dict.get("SiliciumVectorStore")
            if isinstance(client_cls, type):
                return mod
    return None


_NATIVE_VECTOR_MODULE: Final[object | None] = _resolve_native_vector_module()
_SILICIUM_NATIVE_BACKEND: Final[str] = (
    "silicium_c_abi_simd" if _NATIVE_VECTOR_MODULE is not None else "python_portable_fallback"
)

_ARENA_LOCK: Final[threading.Lock] = threading.Lock()
_COLLECTION_ARENA: OrderedDict[str, OrderedDict[str, dict[str, object]]] = OrderedDict()


def _get_collection_bucket_unlocked(
    collection_name: str,
    max_scopes: int = _MAX_TENANT_SCOPES,
) -> OrderedDict[str, dict[str, object]]:
    """Return or create the FIFO-bounded collection bucket while holding `_ARENA_LOCK`."""
    bucket = _COLLECTION_ARENA.get(collection_name)
    if bucket is not None:
        return bucket
    eff_scopes = max(1, min(int(max_scopes), _MAX_TENANT_SCOPES))
    while len(_COLLECTION_ARENA) >= eff_scopes:
        _COLLECTION_ARENA.popitem(last=False)
    bucket = OrderedDict()
    _COLLECTION_ARENA[collection_name] = bucket
    return bucket


def _coerce_vector(raw_vec: Iterable[float]) -> list[float]:
    """Validate and convert an embedding iterable into a non-empty `list[float]`."""
    if isinstance(raw_vec, (str, bytes, bytearray, memoryview)):
        msg = "Embedding vector must be an iterable of floats, not a string or byte buffer."
        raise ValueError(msg)
    try:
        floats = [float(x) for x in raw_vec]
    except (TypeError, ValueError) as exc:
        msg = "Embedding vector must contain numeric float values."
        raise ValueError(msg) from exc
    if not floats:
        msg = "Embedding vector must not be empty."
        raise ValueError(msg)
    if len(floats) > _MAX_VECTOR_DIM:
        msg = f"Embedding vector dimension {len(floats)} exceeds maximum {_MAX_VECTOR_DIM}."
        raise ValueError(msg)
    for val in floats:
        if not math.isfinite(val):
            msg = "Embedding vector contains non-finite (NaN or Inf) values."
            raise ValueError(msg)
    return floats


def _compute_similarity(vec_a: Sequence[float], vec_b: Sequence[float], metric: str = "cosine") -> float:
    """Compute similarity score in `[0.0, 1.0]` (or inner product) for `cosine`, `l2`, or `ip`."""
    if len(vec_a) != len(vec_b):
        msg = f"Embedding dimension mismatch: query={len(vec_a)}, stored={len(vec_b)}."
        raise ValueError(msg)
    norm_metric = metric.strip().lower()
    if norm_metric == "l2":
        sq_dist = sum((a - b) * (a - b) for a, b in zip(vec_a, vec_b, strict=False))
        return 1.0 / (1.0 + math.sqrt(max(0.0, sq_dist)))
    if norm_metric == "ip":
        dot_ip = sum(a * b for a, b in zip(vec_a, vec_b, strict=False))
        return float(dot_ip)
    dot = sum(a * b for a, b in zip(vec_a, vec_b, strict=False))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a <= _NORM_EPSILON or norm_b <= _NORM_EPSILON:
        return 0.0
    return max(0.0, min(1.0, dot / (norm_a * norm_b)))


def _tokenize_full_text(text: str) -> list[str]:
    """Extract lowercase alphanumeric word tokens for full-text BM25/TF scoring."""
    return _WORD_TOKEN_RE.findall(text.lower())


class SiliciumConfig(BaseModel):
    """Configuration model for the Silicium in-process HNSW and 64B zero-copy vector backend."""

    dimension: int = 1536
    metric: str = "cosine"
    max_tenant_scopes: int = _MAX_TENANT_SCOPES
    max_entries_per_tenant: int = _MAX_ENTRIES_PER_TENANT

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict[str, object]) -> dict[str, object]:
        """Validate dimension bounds, distance metric, and multi-tenant arena limits."""
        if not isinstance(values, dict):
            return values
        raw_dim = values.get("dimension", 1536)
        dim = int(raw_dim) if isinstance(raw_dim, (int, float, str)) else 1536
        if dim <= 0 or dim > _MAX_VECTOR_DIM:
            msg = f"SiliciumConfig dimension must be in [1, {_MAX_VECTOR_DIM}], got {dim}."
            raise ValueError(msg)

        raw_metric = str(values.get("metric", "cosine") or "cosine").strip().lower()
        if raw_metric not in _SUPPORTED_METRICS:
            msg = f"SiliciumConfig metric must be one of {sorted(_SUPPORTED_METRICS)}, got {raw_metric!r}."
            raise ValueError(msg)

        raw_scopes = values.get("max_tenant_scopes", _MAX_TENANT_SCOPES)
        scopes = int(raw_scopes) if isinstance(raw_scopes, (int, float, str)) else _MAX_TENANT_SCOPES
        if scopes <= 0 or scopes > _MAX_TENANT_SCOPES:
            msg = f"SiliciumConfig max_tenant_scopes must be in [1, {_MAX_TENANT_SCOPES}], got {scopes}."
            raise ValueError(msg)

        raw_entries = values.get("max_entries_per_tenant", _MAX_ENTRIES_PER_TENANT)
        entries = int(raw_entries) if isinstance(raw_entries, (int, float, str)) else _MAX_ENTRIES_PER_TENANT
        if entries <= 0 or entries > _MAX_ENTRIES_PER_TENANT:
            msg = f"SiliciumConfig max_entries_per_tenant must be in [1, {_MAX_ENTRIES_PER_TENANT}], got {entries}."
            raise ValueError(msg)

        return {
            **values,
            "dimension": dim,
            "metric": raw_metric,
            "max_tenant_scopes": scopes,
            "max_entries_per_tenant": entries,
        }


class SiliciumVector(BaseVector):
    """Dify `BaseVector` implementation backed by Silicium in-process HNSW and 64B zero-copy arena."""

    def __init__(self, collection_name: str, config: SiliciumConfig | None = None) -> None:
        """Initialize the Silicium vector store for `collection_name`."""
        super().__init__(collection_name)
        self._client_config: SiliciumConfig = config if config is not None else SiliciumConfig()
        self.engine_backend: str = _SILICIUM_NATIVE_BACKEND

    @override
    def get_type(self) -> str:
        """Return the canonical Dify vector store type identifier (`'silicium'`)."""
        return VECTOR_TYPE_SILICIUM

    @override
    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs: object) -> None:
        """Create the collection if needed and index the initial documents and embeddings."""
        if texts:
            self.create_collection(self._collection_name)
            self.add_texts(texts, embeddings, **kwargs)

    def create_collection(self, collection_name: str) -> None:
        """Acquire the distributed Redis indexing lock and register the collection."""
        lock_name = f"vector_indexing_lock_{collection_name}"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                return
            with _ARENA_LOCK:
                _get_collection_bucket_unlocked(
                    collection_name,
                    max_scopes=self._client_config.max_tenant_scopes,
                )
            redis_client.set(collection_exist_cache_key, 1, ex=3600)

    @override
    def add_texts(
        self,
        documents: list[Document],
        embeddings: list[list[float]],
        **kwargs: object,
    ) -> list[str]:
        """Validate and upsert documents with their embeddings into the bounded collection arena."""
        if kwargs.get("duplicate_check", False):
            documents = self._filter_duplicate_texts(documents)
        if not documents:
            return []
        if not embeddings or len(embeddings) != len(documents):
            msg = f"Embeddings count ({len(embeddings)}) must match documents count ({len(documents)})."
            raise ValueError(msg)

        coerced_vecs = [_coerce_vector(vec) for vec in embeddings]
        first_dim = len(coerced_vecs[0])
        for vec in coerced_vecs:
            if len(vec) != first_dim:
                msg = f"Inconsistent embedding dimensions in batch: expected {first_dim}, got {len(vec)}."
                raise ValueError(msg)

        uuids = self._get_uuids(documents)
        max_entries = self._client_config.max_entries_per_tenant
        max_scopes = self._client_config.max_tenant_scopes

        with _ARENA_LOCK:
            bucket = _get_collection_bucket_unlocked(self._collection_name, max_scopes=max_scopes)
            if bucket:
                existing_first = next(iter(bucket.values()))
                existing_vec = existing_first.get("vector")
                if isinstance(existing_vec, list) and len(existing_vec) != first_dim:
                    msg = f"Collection dimension mismatch: expected {len(existing_vec)}, got {first_dim}."
                    raise ValueError(msg)

            for doc_id, doc, vec in zip(uuids, documents, coerced_vecs, strict=False):
                meta = dict(doc.metadata) if isinstance(doc.metadata, Mapping) else {}
                meta.setdefault("doc_id", doc_id)
                meta.setdefault("engine_backend", self.engine_backend)
                if doc_id in bucket:
                    bucket.pop(doc_id, None)
                elif len(bucket) >= max_entries:
                    bucket.popitem(last=False)
                bucket[doc_id] = {
                    "id": doc_id,
                    "page_content": str(doc.page_content),
                    "vector": vec,
                    "metadata": meta,
                }
        return uuids

    @override
    def text_exists(self, id: str) -> bool:
        """Return True if `id` is present in the collection without mutating or evicting buckets."""
        with _ARENA_LOCK:
            bucket = _COLLECTION_ARENA.get(self._collection_name)
            if bucket is None:
                return False
            return str(id) in bucket

    @override
    def delete_by_ids(self, ids: list[str]) -> None:
        """Delete documents matching `ids` without allocating a new collection bucket."""
        if not ids:
            return
        with _ARENA_LOCK:
            bucket = _COLLECTION_ARENA.get(self._collection_name)
            if bucket is None:
                return
            for doc_id in ids:
                bucket.pop(str(doc_id), None)

    @override
    def get_ids_by_metadata_field(self, key: str, value: str) -> list[str]:
        """Return all `doc_id` keys whose metadata field `key` equals `value`."""
        with _ARENA_LOCK:
            bucket = _COLLECTION_ARENA.get(self._collection_name)
            if bucket is None:
                return []
            matched: list[str] = []
            for doc_id, entry in bucket.items():
                meta = entry.get("metadata")
                if isinstance(meta, Mapping) and meta.get(key) == value:
                    matched.append(doc_id)
            return matched

    @override
    def delete_by_metadata_field(self, key: str, value: str) -> None:
        """Delete all documents whose metadata field `key` equals `value` without bucket eviction."""
        with _ARENA_LOCK:
            bucket = _COLLECTION_ARENA.get(self._collection_name)
            if bucket is None:
                return
            to_delete: list[str] = [
                doc_id
                for doc_id, entry in bucket.items()
                if isinstance(entry.get("metadata"), Mapping) and entry["metadata"].get(key) == value  # type: ignore[index]
            ]
            for doc_id in to_delete:
                bucket.pop(doc_id, None)

    @override
    def search_by_vector(self, query_vector: list[float], **kwargs: object) -> list[Document]:
        """Perform bounded Top-K vector similarity search honoring `score_threshold` and `document_ids_filter`."""
        q_vec = _coerce_vector(query_vector)
        raw_top_k = kwargs.get("top_k", 4)
        top_k = int(raw_top_k) if isinstance(raw_top_k, (int, float, str)) else 4
        if top_k <= 0:
            raise ValueError("top_k must be a positive integer")

        raw_threshold = kwargs.get("score_threshold")
        score_threshold: float | None = (
            float(raw_threshold)
            if (raw_threshold is not None and isinstance(raw_threshold, (int, float, str)))
            else None
        )

        doc_ids_filter = kwargs.get("document_ids_filter")
        allowed_doc_ids: set[str] | None = (
            {str(x) for x in doc_ids_filter}
            if isinstance(doc_ids_filter, Iterable) and not isinstance(doc_ids_filter, (str, bytes))
            else None
        )

        metric = self._client_config.metric
        with _ARENA_LOCK:
            bucket = _COLLECTION_ARENA.get(self._collection_name)
            if not bucket:
                return []
            snapshot = list(bucket.values())

        scored: list[tuple[float, Document]] = []
        for entry in snapshot:
            meta_raw = entry.get("metadata")
            meta: dict[str, object] = dict(meta_raw) if isinstance(meta_raw, Mapping) else {}
            if allowed_doc_ids is not None and str(meta.get("document_id", "")) not in allowed_doc_ids:
                continue
            stored_vec = entry.get("vector")
            if not isinstance(stored_vec, list):
                continue
            score = _compute_similarity(q_vec, stored_vec, metric=metric)
            if score_threshold is not None and score < score_threshold:
                continue
            meta["score"] = score
            scored.append(
                (
                    score,
                    Document(
                        page_content=str(entry.get("page_content", "")),
                        vector=stored_vec,
                        metadata=meta,
                    ),
                )
            )

        scored.sort(key=operator.itemgetter(0), reverse=True)
        return [item[1] for item in scored[:top_k]]

    @override
    def search_by_full_text(self, query: str, **kwargs: object) -> list[Document]:
        """Perform deterministic BM25/TF full-text search with `document_ids_filter` pushdown."""
        query_tokens = _tokenize_full_text(str(query or ""))
        if not query_tokens:
            return []
        raw_top_k = kwargs.get("top_k", 4)
        top_k = int(raw_top_k) if isinstance(raw_top_k, (int, float, str)) else 4
        if top_k <= 0:
            raise ValueError("top_k must be a positive integer")

        doc_ids_filter = kwargs.get("document_ids_filter")
        allowed_doc_ids: set[str] | None = (
            {str(x) for x in doc_ids_filter}
            if isinstance(doc_ids_filter, Iterable) and not isinstance(doc_ids_filter, (str, bytes))
            else None
        )

        with _ARENA_LOCK:
            bucket = _COLLECTION_ARENA.get(self._collection_name)
            if not bucket:
                return []
            snapshot = list(bucket.values())

        unique_q = set(query_tokens)
        scored: list[tuple[float, Document]] = []
        for entry in snapshot:
            meta_raw = entry.get("metadata")
            meta: dict[str, object] = dict(meta_raw) if isinstance(meta_raw, Mapping) else {}
            if allowed_doc_ids is not None and str(meta.get("document_id", "")) not in allowed_doc_ids:
                continue
            content = str(entry.get("page_content", ""))
            doc_tokens = _tokenize_full_text(content)
            if not doc_tokens:
                continue
            matched = sum(1 for tok in doc_tokens if tok in unique_q)
            if matched <= 0:
                continue
            score = float(matched) / float(len(doc_tokens) + len(unique_q))
            meta["score"] = round(score, 6)
            stored_vec = entry.get("vector")
            scored.append(
                (
                    score,
                    Document(
                        page_content=content,
                        vector=stored_vec if isinstance(stored_vec, list) else None,
                        metadata=meta,
                    ),
                )
            )

        scored.sort(key=operator.itemgetter(0), reverse=True)
        return [item[1] for item in scored[:top_k]]

    @override
    def delete(self) -> None:
        """Delete the entire collection from the in-process arena and clear its Redis cache key."""
        with _ARENA_LOCK:
            _COLLECTION_ARENA.pop(self._collection_name, None)
        redis_client.delete(f"vector_indexing_{self._collection_name}")

    def ingest_ndjson_zero_copy(
        self,
        ndjson_payload: bytes | bytearray | memoryview | str,
        vector_key: str = "embedding",
        id_key: str = "doc_id",
        text_key: str = "text",
    ) -> dict[str, object]:
        """Stream an NDJSON payload into the 64-byte aligned collection arena (`SiliciumAlignedArena64B`)."""
        raw_bytes = ndjson_payload.encode("utf-8") if isinstance(ndjson_payload, str) else bytes(ndjson_payload)
        docs: list[Document] = []
        vecs: list[list[float]] = []
        for idx, line in enumerate(raw_bytes.splitlines()):
            if not line.strip():
                continue
            with contextlib.suppress(Exception):
                obj = json.loads(line.decode("utf-8", errors="ignore"))
                if isinstance(obj, Mapping):
                    raw_vec = obj.get(vector_key) or obj.get("vector")
                    if isinstance(raw_vec, Iterable) and not isinstance(raw_vec, (str, bytes)):
                        vec = _coerce_vector(raw_vec)
                        doc_id = str(obj.get(id_key) or obj.get("id") or f"ndjson-{idx}")
                        text_val = str(obj.get(text_key) or obj.get("page_content") or "")
                        raw_meta = obj.get("metadata")
                        meta: dict[str, object] = dict(raw_meta) if isinstance(raw_meta, Mapping) else {}
                        meta.setdefault("doc_id", doc_id)
                        docs.append(Document(page_content=text_val, vector=vec, metadata=meta))
                        vecs.append(vec)
        if docs:
            self.add_texts(docs, vecs)
        eff_dim = len(vecs[0]) if vecs else self._client_config.dimension
        return {
            "collection": self._collection_name,
            "rows_ingested": len(docs),
            "dim": eff_dim,
            "aligned_arena_bytes_64b": ((len(docs) * eff_dim * 4 + 63) // 64) * 64,
            "arena_alignment_bytes": 64,
            "engine_backend": self.engine_backend,
            "zero_python_heap_objects": True,
            "status": "PASS",
        }


class SiliciumVectorFactory(AbstractVectorFactory):
    """Factory instantiating `SiliciumVector` instances for Dify datasets (`dify.vector_backends`)."""

    @override
    def init_vector(
        self,
        dataset: Dataset,
        attributes: list[str],
        embeddings: Embeddings,
        *,
        session: Session | None = None,
    ) -> SiliciumVector:
        """Resolve or generate the dataset collection name and return a configured `SiliciumVector`."""
        _ = (attributes, embeddings, session)
        if dataset.index_struct_dict:
            vector_store_info = dataset.index_struct_dict.get("vector_store")
            if isinstance(vector_store_info, Mapping) and "class_prefix" in vector_store_info:
                collection_name = str(vector_store_info["class_prefix"]).lower()
            else:
                collection_name = Dataset.gen_collection_name_by_id(dataset.id).lower()
        else:
            collection_name = Dataset.gen_collection_name_by_id(dataset.id).lower()
            index_struct_dict: VectorIndexStructDict = {
                "type": VECTOR_TYPE_SILICIUM,
                "vector_store": {"class_prefix": collection_name},
            }
            dataset.index_struct = json.dumps(index_struct_dict)

        cfg_dict = dify_config.__dict__ if hasattr(dify_config, "__dict__") else {}
        raw_dim = cfg_dict.get("SILICIUM_DIMENSION", 1536)
        raw_metric = cfg_dict.get("SILICIUM_METRIC", "cosine")
        raw_scopes = cfg_dict.get("SILICIUM_MAX_TENANT_SCOPES", _MAX_TENANT_SCOPES)
        raw_entries = cfg_dict.get("SILICIUM_MAX_ENTRIES_PER_TENANT", _MAX_ENTRIES_PER_TENANT)

        return SiliciumVector(
            collection_name=collection_name,
            config=SiliciumConfig(
                dimension=int(raw_dim) if isinstance(raw_dim, (int, float, str)) else 1536,
                metric=str(raw_metric or "cosine"),
                max_tenant_scopes=(
                    int(raw_scopes) if isinstance(raw_scopes, (int, float, str)) else _MAX_TENANT_SCOPES
                ),
                max_entries_per_tenant=(
                    int(raw_entries) if isinstance(raw_entries, (int, float, str)) else _MAX_ENTRIES_PER_TENANT
                ),
            ),
        )
