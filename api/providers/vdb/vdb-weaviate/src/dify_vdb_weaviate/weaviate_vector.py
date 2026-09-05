"""
Weaviate vector database implementation for Dify's RAG system.

This module provides integration with Weaviate vector database for storing and retrieving
document embeddings used in retrieval-augmented generation workflows.
"""

import atexit
import datetime
import hashlib
import json
import logging
import threading
import uuid as _uuid
from typing import Any, override
from urllib.parse import urlparse

import weaviate
import weaviate.classes.config as wc
from pydantic import BaseModel, model_validator
from weaviate.classes.data import DataObject
from weaviate.classes.init import Auth
from weaviate.classes.query import Filter, MetadataQuery
from weaviate.exceptions import UnexpectedStatusCodeError, WeaviateQueryError

from configs import dify_config
from core.rag.datasource.vdb.field import Field
from core.rag.datasource.vdb.vector_base import BaseVector, VectorIndexStructDict, VectorStoreDict
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)

_weaviate_client: weaviate.WeaviateClient | None = None
_weaviate_client_lock = threading.Lock()


def _shutdown_weaviate_client() -> None:
    """
    Best-effort shutdown hook to close the module-level Weaviate client.

    This is registered with atexit so that HTTP/gRPC resources are released
    when the Python interpreter exits.
    """
    global _weaviate_client

    # Ensure thread-safety when accessing the shared client instance
    with _weaviate_client_lock:
        client = _weaviate_client
        _weaviate_client = None

    if client is not None:
        try:
            client.close()
        except Exception:
            # Best-effort cleanup; log at debug level and ignore errors.
            logger.debug("Failed to close Weaviate client during shutdown", exc_info=True)


# Register the shutdown hook once per process.
atexit.register(_shutdown_weaviate_client)


class WeaviateConfig(BaseModel):
    """
    Configuration model for Weaviate connection settings.

    Attributes:
        endpoint: Weaviate server endpoint URL
        grpc_endpoint: Optional Weaviate gRPC server endpoint URL
        api_key: Optional API key for authentication
        batch_size: Number of objects to batch per insert operation
    """

    endpoint: str
    grpc_endpoint: str | None = None
    api_key: str | None = None
    batch_size: int = 100

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict[str, Any]) -> dict[str, Any]:
        """Validates that required configuration values are present."""
        if not values["endpoint"]:
            raise ValueError("config WEAVIATE_ENDPOINT is required")
        return values


class WeaviateVector(BaseVector):
    """
    Weaviate vector database implementation for document storage and retrieval.

    Handles creation, insertion, deletion, and querying of document embeddings
    in a Weaviate collection.
    """

    _DOCUMENT_ID_PROPERTY = "document_id"
    # Class-level default so instances built without __init__ (e.g. via __new__) default to the
    # legacy, non-multi-tenant layout. __init__ overrides this per instance.
    _tenant: str | None = None

    def __init__(self, collection_name: str, config: WeaviateConfig, attributes: list, tenant: str | None = None):
        """
        Initializes the Weaviate vector store.

        Args:
            collection_name: Name of the Weaviate collection
            config: Weaviate configuration settings
            attributes: List of metadata attributes to store
            tenant: Optional Weaviate tenant name. When set, the store operates on a single
                isolated tenant within a shared multi-tenant collection (one tenant per dataset).
                When None, the store uses the legacy collection-per-dataset layout.
        """
        super().__init__(collection_name)
        self._client = self._init_client(config)
        self._attributes = attributes
        self._tenant = tenant

    def _collection(self):
        """
        Returns the collection handle for data operations.

        When multi-tenancy is active (``self._tenant`` set), the handle is scoped to this
        dataset's tenant so reads/writes/deletes are isolated. Schema and tenant-management
        operations must use ``self._client.collections.use(...)`` directly (they are
        collection-level, not tenant-scoped).
        """
        col = self._client.collections.use(self._collection_name)
        if self._tenant:
            return col.with_tenant(self._tenant)
        return col

    def _init_client(self, config: WeaviateConfig) -> weaviate.WeaviateClient:
        """
        Initializes and returns a connected Weaviate client.

        Configures both HTTP and gRPC connections with proper authentication.
        """
        global _weaviate_client
        if _weaviate_client and _weaviate_client.is_ready():
            return _weaviate_client

        with _weaviate_client_lock:
            if _weaviate_client and _weaviate_client.is_ready():
                return _weaviate_client

            p = urlparse(config.endpoint)
            host = p.hostname or config.endpoint.replace("https://", "").replace("http://", "")
            http_secure = p.scheme == "https"
            http_port = p.port or (443 if http_secure else 80)

            # Parse gRPC configuration
            if config.grpc_endpoint:
                # Urls without scheme won't be parsed correctly in some python versions,
                # see https://bugs.python.org/issue27657
                grpc_endpoint_with_scheme = (
                    config.grpc_endpoint if "://" in config.grpc_endpoint else f"grpc://{config.grpc_endpoint}"
                )
                grpc_p = urlparse(grpc_endpoint_with_scheme)
                grpc_host = grpc_p.hostname or "localhost"
                grpc_port = grpc_p.port or (443 if grpc_p.scheme == "grpcs" else 50051)
                grpc_secure = grpc_p.scheme == "grpcs"
            else:
                # Infer from HTTP endpoint as fallback
                grpc_host = host
                grpc_secure = http_secure
                grpc_port = 443 if grpc_secure else 50051

            client = weaviate.connect_to_custom(
                http_host=host,
                http_port=http_port,
                http_secure=http_secure,
                grpc_host=grpc_host,
                grpc_port=grpc_port,
                grpc_secure=grpc_secure,
                auth_credentials=Auth.api_key(config.api_key) if config.api_key else None,
                skip_init_checks=True,  # Skip PyPI version check to avoid unnecessary HTTP requests
            )

            if not client.is_ready():
                raise ConnectionError("Vector database is not ready")

            _weaviate_client = client
            return client

    @override
    def get_type(self) -> str:
        """Returns the vector database type identifier."""
        return VectorType.WEAVIATE

    def get_collection_name(self, dataset: Dataset) -> str:
        """
        Retrieves or generates the collection name for a dataset.

        Uses existing index structure if available, otherwise generates from dataset ID.
        """
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            if not class_prefix.endswith("_Node"):
                class_prefix += "_Node"
            return class_prefix

        dataset_id = dataset.id
        return Dataset.gen_collection_name_by_id(dataset_id)

    def to_index_struct(self) -> VectorIndexStructDict:
        """Returns the index structure dictionary for persistence (records the tenant under multi-tenancy)."""
        vector_store: VectorStoreDict = {"class_prefix": self._collection_name}
        if self._tenant:
            vector_store["multi_tenant"] = True
            vector_store["tenant"] = self._tenant
        result: VectorIndexStructDict = {
            "type": self.get_type(),
            "vector_store": vector_store,
        }
        return result

    @override
    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        """
        Creates a new collection and adds initial documents with embeddings.
        """
        self._create_collection()
        self.add_texts(texts, embeddings)

    def _create_collection(self):
        """
        Creates the Weaviate collection with required schema if it doesn't exist.

        Uses Redis locking to prevent concurrent creation attempts.
        """
        lock_name = f"vector_indexing_lock_{self._collection_name}"
        with redis_client.lock(lock_name, timeout=20):
            # Under multi-tenancy the shared collection is created once, but every dataset
            # (tenant) sharing it still needs its own tenant ensured, so scope the cache key
            # by tenant to avoid short-circuiting tenant creation for later datasets.
            cache_key = f"vector_indexing_{self._collection_name}"
            if self._tenant:
                cache_key = f"{cache_key}_{self._tenant}"
            if redis_client.get(cache_key):
                return

            try:
                if not self._client.collections.exists(self._collection_name):
                    tokenization = (
                        wc.Tokenization(dify_config.WEAVIATE_TOKENIZATION)
                        if dify_config.WEAVIATE_TOKENIZATION
                        else wc.Tokenization.WORD
                    )
                    self._client.collections.create(
                        name=self._collection_name,
                        properties=[
                            wc.Property(
                                name=Field.TEXT_KEY.value,
                                data_type=wc.DataType.TEXT,
                                tokenization=tokenization,
                            ),
                            wc.Property(name="document_id", data_type=wc.DataType.TEXT),
                            wc.Property(name="doc_id", data_type=wc.DataType.TEXT),
                            wc.Property(name="doc_type", data_type=wc.DataType.TEXT),
                            wc.Property(name="chunk_index", data_type=wc.DataType.INT),
                            wc.Property(name="is_summary", data_type=wc.DataType.BOOL),
                            wc.Property(name="original_chunk_id", data_type=wc.DataType.TEXT),
                        ],
                        vector_config=wc.Configure.Vectors.self_provided(
                            vector_index_config=self._build_vector_index_config(),
                        ),
                        multi_tenancy_config=(
                            wc.Configure.multi_tenancy(
                                enabled=True,
                                auto_tenant_creation=True,
                                auto_tenant_activation=True,
                            )
                            if self._tenant
                            else None
                        ),
                        replication_config=(
                            wc.Configure.replication(factor=dify_config.WEAVIATE_REPLICATION_FACTOR)
                            if dify_config.WEAVIATE_REPLICATION_FACTOR > 1
                            else None
                        ),
                    )

                self._ensure_properties()
                self._ensure_tenant()
                redis_client.set(cache_key, 1, ex=3600)
            except Exception as e:
                if (dify_config.WEAVIATE_INDEX_TYPE or "").lower() == "dynamic":
                    logger.exception(
                        "Error creating collection %s with a dynamic vector index. A dynamic index requires "
                        "ASYNC_INDEXING=true on the Weaviate server (WEAVIATE_ASYNC_INDEXING=true).",
                        self._collection_name,
                    )
                else:
                    logger.exception("Error creating collection %s", self._collection_name)
                raise

    def _build_quantizer(self):
        """
        Builds a vector quantizer config from WEAVIATE_COMPRESSION, or None for no compression.

        A fresh config object is returned on each call because a single quantizer config cannot be
        reused across multiple index configs (e.g. the hnsw and flat phases of a dynamic index).
        """
        compression = (dify_config.WEAVIATE_COMPRESSION or "none").lower()
        cache = dify_config.WEAVIATE_COMPRESSION_CACHE
        if compression in ("", "none"):
            return None
        if compression == "rq":
            return wc.Configure.VectorIndex.Quantizer.rq(bits=dify_config.WEAVIATE_RQ_BITS, cache=cache)
        if compression == "pq":
            return wc.Configure.VectorIndex.Quantizer.pq(
                segments=dify_config.WEAVIATE_PQ_SEGMENTS,
                training_limit=dify_config.WEAVIATE_PQ_TRAINING_LIMIT,
            )
        if compression == "bq":
            return wc.Configure.VectorIndex.Quantizer.bq(cache=cache)
        if compression == "sq":
            return wc.Configure.VectorIndex.Quantizer.sq(
                training_limit=dify_config.WEAVIATE_SQ_TRAINING_LIMIT,
                cache=cache,
            )
        raise ValueError(f"Unsupported WEAVIATE_COMPRESSION value: {dify_config.WEAVIATE_COMPRESSION}")

    def _build_vector_index_config(self):
        """
        Builds the vector index config (hnsw/flat/dynamic) with the configured distance metric and
        compression. A flat index — including the flat phase of a dynamic index — only supports BQ.
        """
        index_type = (dify_config.WEAVIATE_INDEX_TYPE or "hnsw").lower()
        compression = (dify_config.WEAVIATE_COMPRESSION or "none").lower()
        distance = wc.VectorDistances(dify_config.WEAVIATE_DISTANCE_METRIC)

        if index_type == "flat":
            if compression not in ("none", "bq"):
                raise ValueError("A flat Weaviate index supports only 'bq' compression (WEAVIATE_COMPRESSION=bq).")
            return wc.Configure.VectorIndex.flat(distance_metric=distance, quantizer=self._build_quantizer())
        if index_type == "dynamic":
            # The flat phase only supports BQ; drop any non-BQ quantizer from it while keeping it on HNSW.
            flat_quantizer = self._build_quantizer() if compression in ("none", "bq") else None
            return wc.Configure.VectorIndex.dynamic(
                distance_metric=distance,
                threshold=dify_config.WEAVIATE_DYNAMIC_INDEX_THRESHOLD,
                hnsw=wc.Configure.VectorIndex.hnsw(distance_metric=distance, quantizer=self._build_quantizer()),
                flat=wc.Configure.VectorIndex.flat(distance_metric=distance, quantizer=flat_quantizer),
            )
        if index_type == "hnsw":
            return wc.Configure.VectorIndex.hnsw(distance_metric=distance, quantizer=self._build_quantizer())
        raise ValueError(f"Unsupported WEAVIATE_INDEX_TYPE value: {dify_config.WEAVIATE_INDEX_TYPE}")

    def _ensure_tenant(self) -> None:
        """Ensures this dataset's tenant exists in the shared multi-tenant collection (no-op without MT)."""
        if not self._tenant:
            return
        if not self._client.collections.exists(self._collection_name):
            return
        col = self._client.collections.use(self._collection_name)
        try:
            if not col.tenants.exists(self._tenant):
                col.tenants.create(self._tenant)
        except Exception as e:
            logger.warning("Could not ensure tenant %s on collection %s: %s", self._tenant, self._collection_name, e)

    def _ensure_properties(self) -> None:
        """
        Ensures all required properties exist in the collection schema.

        Adds missing properties if the collection exists but lacks them.
        """
        if not self._client.collections.exists(self._collection_name):
            return

        col = self._client.collections.use(self._collection_name)
        cfg = col.config.get()
        existing = {p.name for p in (cfg.properties or [])}

        to_add = []
        if "document_id" not in existing:
            to_add.append(wc.Property(name="document_id", data_type=wc.DataType.TEXT))
        if "doc_id" not in existing:
            to_add.append(wc.Property(name="doc_id", data_type=wc.DataType.TEXT))
        if "doc_type" not in existing:
            to_add.append(wc.Property(name="doc_type", data_type=wc.DataType.TEXT))
        if "chunk_index" not in existing:
            to_add.append(wc.Property(name="chunk_index", data_type=wc.DataType.INT))
        if "is_summary" not in existing:
            to_add.append(wc.Property(name="is_summary", data_type=wc.DataType.BOOL))
        if "original_chunk_id" not in existing:
            to_add.append(wc.Property(name="original_chunk_id", data_type=wc.DataType.TEXT))

        for prop in to_add:
            try:
                col.config.add_property(prop)
            except Exception as e:
                logger.warning("Could not add property %s: %s", prop.name, e)

    @override
    def _get_uuids(self, documents: list[Document]) -> list[str]:
        """
        Generates deterministic UUIDs for documents based on their content.

        Uses UUID5 with URL namespace to ensure consistent IDs for identical content.
        """
        URL_NAMESPACE = _uuid.UUID("6ba7b811-9dad-11d1-80b4-00c04fd430c8")

        uuids = []
        for doc in documents:
            uuid_val = _uuid.uuid5(URL_NAMESPACE, doc.page_content)
            uuids.append(str(uuid_val))

        return uuids

    @override
    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        """
        Adds documents with their embeddings to the collection.

        Batches insertions for efficiency and returns the list of inserted object IDs.
        """
        uuids = self._get_uuids(documents)
        texts = [d.page_content for d in documents]
        metadatas = [d.metadata for d in documents]

        col = self._collection()
        objs: list[DataObject] = []
        ids_out: list[str] = []

        for i, text in enumerate(texts):
            props: dict[str, Any] = {Field.TEXT_KEY.value: text}
            meta = metadatas[i] or {}
            for k, v in meta.items():
                props[k] = self._json_serializable(v)

            candidate = uuids[i] if uuids else None
            uid = candidate if (candidate and self._is_uuid(candidate)) else str(_uuid.uuid4())
            ids_out.append(uid)

            vec_payload = None
            if embeddings and i < len(embeddings) and embeddings[i]:
                vec_payload = {"default": embeddings[i]}

            objs.append(
                DataObject(
                    uuid=uid,
                    properties=props,  # type: ignore[arg-type]  # mypy incorrectly infers DataObject signature
                    vector=vec_payload,
                )
            )

        with col.batch.dynamic() as batch:
            for obj in objs:
                batch.add_object(properties=obj.properties, uuid=obj.uuid, vector=obj.vector)

        return ids_out

    def _is_uuid(self, val: str) -> bool:
        """Validates whether a string is a valid UUID format."""
        try:
            _uuid.UUID(str(val))
            return True
        except Exception:
            return False

    @override
    def delete_by_metadata_field(self, key: str, value: str) -> None:
        """Deletes all objects matching a specific metadata field value."""
        if not self._client.collections.exists(self._collection_name):
            return

        col = self._collection()
        col.data.delete_many(where=Filter.by_property(key).equal(value))

    @override
    def delete(self):
        """
        Deletes this dataset's data from Weaviate.

        Under multi-tenancy this removes only this dataset's tenant from the shared collection,
        leaving other datasets' tenants intact; otherwise it deletes the whole per-dataset collection.
        """
        if not self._client.collections.exists(self._collection_name):
            return
        if self._tenant:
            col = self._client.collections.use(self._collection_name)
            try:
                col.tenants.remove(self._tenant)
            except Exception as e:
                logger.warning(
                    "Could not remove tenant %s from collection %s: %s",
                    self._tenant,
                    self._collection_name,
                    e,
                )
        else:
            self._client.collections.delete(self._collection_name)

    @override
    def text_exists(self, id: str) -> bool:
        """Checks if a document with the given doc_id exists in the collection."""
        if not self._client.collections.exists(self._collection_name):
            return False

        col = self._collection()
        res = col.query.fetch_objects(
            filters=Filter.by_property("doc_id").equal(id),
            limit=1,
            return_properties=["doc_id"],
        )

        return len(res.objects) > 0

    @override
    def delete_by_ids(self, ids: list[str]) -> None:
        """
        Deletes objects by their UUID identifiers.

        Silently ignores 404 errors for non-existent IDs.
        """
        if not self._client.collections.exists(self._collection_name):
            return

        col = self._collection()

        for uid in ids:
            try:
                col.data.delete_by_id(uid)
            except UnexpectedStatusCodeError as e:
                if getattr(e, "status_code", None) != 404:
                    raise

    @override
    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        """
        Performs vector similarity search using the provided query vector.

        Filters by document IDs if provided and applies score threshold.
        Returns documents sorted by relevance score.
        """
        if not self._client.collections.exists(self._collection_name):
            return []

        col = self._collection()
        props = list({*self._attributes, self._DOCUMENT_ID_PROPERTY, Field.TEXT_KEY.value})

        where = None
        doc_ids = kwargs.get("document_ids_filter") or []
        if doc_ids:
            where = Filter.by_property(self._DOCUMENT_ID_PROPERTY).contains_any(doc_ids)

        top_k = int(kwargs.get("top_k", 4))
        score_threshold = float(kwargs.get("score_threshold") or 0.0)

        try:
            res = col.query.near_vector(
                near_vector=query_vector,
                limit=top_k,
                return_properties=props,
                return_metadata=MetadataQuery(distance=True),
                include_vector=False,
                filters=where,
                target_vector="default",
            )
        except WeaviateQueryError:
            self._ensure_properties()
            res = col.query.near_vector(
                near_vector=query_vector,
                limit=top_k,
                return_properties=props,
                return_metadata=MetadataQuery(distance=True),
                include_vector=False,
                filters=where,
                target_vector="default",
            )

        docs: list[Document] = []
        for obj in res.objects:
            properties = dict(obj.properties or {})
            text = properties.pop(Field.TEXT_KEY.value, "")
            if obj.metadata and obj.metadata.distance is not None:
                distance = obj.metadata.distance
            else:
                distance = 1.0
            score = 1.0 - distance

            if score > score_threshold:
                properties["score"] = score
                docs.append(Document(page_content=text, metadata=properties))

        docs.sort(key=lambda d: d.metadata.get("score", 0.0), reverse=True)
        return docs

    @override
    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        """
        Performs BM25 full-text search on document content.

        Filters by document IDs if provided and returns matching documents with vectors.
        """
        if not self._client.collections.exists(self._collection_name):
            return []

        col = self._collection()
        props = list({*self._attributes, Field.TEXT_KEY.value})

        where = None
        doc_ids = kwargs.get("document_ids_filter") or []
        if doc_ids:
            where = Filter.by_property(self._DOCUMENT_ID_PROPERTY).contains_any(doc_ids)

        top_k = int(kwargs.get("top_k", 4))

        try:
            res = col.query.bm25(
                query=query,
                query_properties=[Field.TEXT_KEY.value],
                limit=top_k,
                return_properties=props,
                include_vector=True,
                filters=where,
            )
        except WeaviateQueryError:
            self._ensure_properties()
            res = col.query.bm25(
                query=query,
                query_properties=[Field.TEXT_KEY.value],
                limit=top_k,
                return_properties=props,
                include_vector=True,
                filters=where,
            )

        docs: list[Document] = []
        for obj in res.objects:
            properties = dict(obj.properties or {})
            text = properties.pop(Field.TEXT_KEY.value, "")

            vec = obj.vector
            if isinstance(vec, dict):
                vec = vec.get("default") or next(iter(vec.values()), None)

            docs.append(Document(page_content=text, vector=vec, metadata=properties))
        return docs

    def _json_serializable(self, value: Any) -> Any:
        """Converts values to JSON-serializable format, handling datetime objects."""
        if isinstance(value, datetime.datetime):
            return value.isoformat()
        return value


class WeaviateVectorFactory(AbstractVectorFactory):
    """Factory class for creating WeaviateVector instances."""

    @staticmethod
    def _gen_shared_collection_name(dataset: Dataset) -> str:
        """
        Generates a deterministic shared collection name for multi-tenancy, keyed by the dataset's
        embedding model. Datasets using the same embedding model (hence the same vector dimension and
        schema) share one collection, each isolated as its own tenant; this avoids creating one
        collection per dataset at scale.
        """
        model_key = f"{dataset.embedding_model_provider or ''}:{dataset.embedding_model or ''}"
        digest = hashlib.sha256(model_key.encode("utf-8")).hexdigest()[:16]
        return f"{dify_config.VECTOR_INDEX_NAME_PREFIX}_shared_{digest}_Node"

    @override
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> WeaviateVector:
        """
        Initializes a WeaviateVector instance for the given dataset.

        Reuses the persisted layout from the dataset index structure when present (so existing
        datasets are never silently migrated). For a new dataset, uses a shared multi-tenant
        collection when WEAVIATE_MULTI_TENANCY_ENABLED is set, otherwise the legacy
        collection-per-dataset layout. The chosen layout is persisted in the index structure.
        """
        tenant: str | None = None
        if dataset.index_struct_dict:
            vector_store = dataset.index_struct_dict["vector_store"]
            collection_name = vector_store["class_prefix"]
            if vector_store.get("multi_tenant"):
                tenant = vector_store.get("tenant") or dataset.id
        elif dify_config.WEAVIATE_MULTI_TENANCY_ENABLED:
            collection_name = self._gen_shared_collection_name(dataset)
            tenant = dataset.id
            index_struct = self.gen_index_struct_dict(VectorType.WEAVIATE, collection_name)
            index_struct["vector_store"]["multi_tenant"] = True
            index_struct["vector_store"]["tenant"] = tenant
            dataset.index_struct = json.dumps(index_struct)
        else:
            collection_name = Dataset.gen_collection_name_by_id(dataset.id)
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.WEAVIATE, collection_name))
        return WeaviateVector(
            collection_name=collection_name,
            config=WeaviateConfig(
                endpoint=dify_config.WEAVIATE_ENDPOINT or "",
                grpc_endpoint=dify_config.WEAVIATE_GRPC_ENDPOINT or "",
                api_key=dify_config.WEAVIATE_API_KEY,
                batch_size=dify_config.WEAVIATE_BATCH_SIZE,
            ),
            attributes=attributes,
            tenant=tenant,
        )
