"""
Weaviate vector database implementation for Dify's RAG system.

This module provides integration with Weaviate vector database for storing and retrieving
document embeddings used in retrieval-augmented generation workflows.
"""

import atexit
import datetime
import json
import logging
import threading
import uuid as _uuid
from itertools import batched
from typing import Any, cast, override
from urllib.parse import urlparse

import weaviate
import weaviate.classes.config as wc
from pydantic import BaseModel, model_validator
from weaviate.classes.data import DataObject
from weaviate.classes.init import Auth
from weaviate.classes.query import Filter, MetadataQuery
from weaviate.collections.classes.filters import FilterReturn
from weaviate.exceptions import WeaviateQueryError

from configs import dify_config
from core.rag.datasource.vdb.field import Field
from core.rag.datasource.vdb.vector_base import BaseVector, VectorIndexStructDict
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)

_DELETE_BATCH_SIZE = 500
_DOC_ID_UUID_NAMESPACE = _uuid.UUID("6ba7b811-9dad-11d1-80b4-00c04fd430c8")

_weaviate_client: weaviate.WeaviateClient | None = None
_weaviate_client_lock = threading.Lock()


def _normalize_result_vector(value: object) -> list[float] | None:
    if not isinstance(value, list) or not all(isinstance(item, int | float) for item in value):
        return None
    return [float(item) for item in cast(list[int | float], value)]


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

    def __init__(self, collection_name: str, config: WeaviateConfig, attributes: list):
        """
        Initializes the Weaviate vector store.

        Args:
            collection_name: Name of the Weaviate collection
            config: Weaviate configuration settings
            attributes: List of metadata attributes to store
        """
        super().__init__(collection_name)
        self._client = self._init_client(config)
        self._attributes = attributes

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
        """Returns the index structure dictionary for persistence."""
        result: VectorIndexStructDict = {
            "type": self.get_type(),
            "vector_store": {"class_prefix": self._collection_name},
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
            cache_key = f"vector_indexing_{self._collection_name}"
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
                            wc.Property(
                                name="document_id",
                                data_type=wc.DataType.TEXT,
                                tokenization=wc.Tokenization.FIELD,
                            ),
                            wc.Property(
                                name="doc_id",
                                data_type=wc.DataType.TEXT,
                                tokenization=wc.Tokenization.FIELD,
                            ),
                            wc.Property(name="doc_type", data_type=wc.DataType.TEXT),
                            wc.Property(name="chunk_index", data_type=wc.DataType.INT),
                            wc.Property(name="is_summary", data_type=wc.DataType.BOOL),
                            wc.Property(name="original_chunk_id", data_type=wc.DataType.TEXT),
                        ],
                        vector_config=wc.Configure.Vectors.self_provided(),
                    )

                self._ensure_properties()
                redis_client.set(cache_key, 1, ex=3600)
            except Exception as e:
                logger.exception("Error creating collection %s", self._collection_name)
                raise

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
            to_add.append(
                wc.Property(name="document_id", data_type=wc.DataType.TEXT, tokenization=wc.Tokenization.FIELD)
            )
        if "doc_id" not in existing:
            to_add.append(wc.Property(name="doc_id", data_type=wc.DataType.TEXT, tokenization=wc.Tokenization.FIELD))
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

    @staticmethod
    def _exact_text_filter(property_name: str, values: list[str]) -> FilterReturn | None:
        """Match complete TEXT-property values without token-overlap leakage."""
        unique_values = list(dict.fromkeys(value for value in values if value))
        if not unique_values:
            return None

        combined = Filter.by_property(property_name).equal(unique_values[0])
        for value in unique_values[1:]:
            combined |= Filter.by_property(property_name).equal(value)
        return combined

    @staticmethod
    def _build_search_filter(kwargs: dict[str, Any]) -> FilterReturn | None:
        """Filter optional document IDs; the selected collection already scopes the dataset."""
        document_ids = [str(document_id) for document_id in kwargs.get("document_ids_filter") or []]
        return WeaviateVector._exact_text_filter("document_id", document_ids)

    @staticmethod
    def _matches_search_scope(properties: dict[str, Any], kwargs: dict[str, Any]) -> bool:
        """Reject document-ID false positives from legacy collections that use WORD tokenization."""
        document_ids = {str(document_id) for document_id in kwargs.get("document_ids_filter") or []}
        if document_ids and str(properties.get("document_id") or "") not in document_ids:
            return False
        return True

    @override
    def _get_uuids(self, texts: list[Document]) -> list[str]:
        """
        Generates deterministic UUIDs from each durable metadata ``doc_id``.

        UUID-shaped handles are preserved. Other handles are namespaced into a
        UUID so identity never depends on document content and identical chunks
        cannot overwrite one another.
        """
        uuids = []
        for doc in texts:
            doc_id = doc.metadata.get("doc_id")
            if doc_id is None or str(doc_id) == "":
                raise ValueError("Document must contain a doc_id")
            try:
                uuid_val = _uuid.UUID(str(doc_id))
            except (TypeError, ValueError, AttributeError):
                uuid_val = _uuid.uuid5(_DOC_ID_UUID_NAMESPACE, str(doc_id))
            uuids.append(str(uuid_val))

        return uuids

    @override
    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        """
        Adds documents with their embeddings to the collection.

        Canonical object UUIDs are derived from ``doc_id``. Existing canonical
        objects are replaced, new objects are inserted in a checked batch, and
        legacy content-derived UUIDs are retired only after publication succeeds.
        """
        uuids = self._get_uuids(documents)
        texts = [d.page_content for d in documents]
        metadatas = [d.metadata for d in documents]

        col = self._client.collections.use(self._collection_name)
        objs: list[DataObject[dict[str, Any]]] = []
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

        doc_ids = [str(metadata["doc_id"]) for metadata in metadatas if metadata.get("doc_id")]
        existing_uuids = self._get_object_uuids_by_doc_id(col, doc_ids)
        objects_to_insert: list[DataObject[dict[str, Any]]] = []
        for obj, metadata in zip(objs, metadatas):
            doc_id = str(metadata["doc_id"]) if metadata.get("doc_id") else None
            object_uuid = obj.uuid
            object_properties = obj.properties
            if object_uuid is None or object_properties is None:
                raise RuntimeError("Weaviate data object is missing its UUID or properties")
            if doc_id is not None and str(object_uuid) in existing_uuids.get(doc_id, set()):
                col.data.replace(uuid=object_uuid, properties=object_properties, vector=obj.vector)
            else:
                objects_to_insert.append(obj)

        if objects_to_insert:
            with col.batch.dynamic() as batch:
                for obj in objects_to_insert:
                    batch.add_object(properties=obj.properties, uuid=obj.uuid, vector=obj.vector)
            self._raise_for_batch_failures(col)

        # Query again after canonical publication so a retry or mixed-version
        # deployment can also retire legacy objects created concurrently.
        canonical_uuid_by_doc_id = {
            str(metadata["doc_id"]): str(obj.uuid) for obj, metadata in zip(objs, metadatas) if metadata.get("doc_id")
        }
        published_uuids = self._get_object_uuids_by_doc_id(col, list(canonical_uuid_by_doc_id))
        legacy_uuids: list[str] = []
        for doc_id, canonical_uuid in canonical_uuid_by_doc_id.items():
            for object_uuid in published_uuids.get(doc_id, set()):
                if object_uuid != canonical_uuid:
                    legacy_uuids.append(object_uuid)
        self._delete_object_uuids(col, legacy_uuids)

        return ids_out

    def _get_object_uuids_by_property(
        self,
        col: Any,
        property_name: str,
        values: list[str],
    ) -> dict[str, set[str]]:
        """Return object UUIDs after exact client-side validation for legacy WORD-tokenized fields."""
        object_uuids: dict[str, set[str]] = {}
        unique_values = list(dict.fromkeys(value for value in values if value))
        for value_batch in batched(unique_values, _DELETE_BATCH_SIZE):
            value_filter = self._exact_text_filter(property_name, list(value_batch))
            if value_filter is None:
                continue
            offset = 0
            while True:
                result = col.query.fetch_objects(
                    filters=value_filter,
                    limit=_DELETE_BATCH_SIZE,
                    offset=offset,
                    return_properties=[property_name],
                    include_vector=False,
                )
                objects = list(result.objects or [])
                for obj in objects:
                    value = (obj.properties or {}).get(property_name)
                    if value is not None and str(value) in value_batch:
                        object_uuids.setdefault(str(value), set()).add(str(obj.uuid))
                if len(objects) < _DELETE_BATCH_SIZE:
                    break
                # Weaviate 1.27 rejects cursor (``after``) pagination when a
                # filter is present. Keep the result set stable until every
                # UUID has been collected, then retire legacy objects.
                offset += len(objects)
        return object_uuids

    def _get_object_uuids_by_doc_id(self, col: Any, doc_ids: list[str]) -> dict[str, set[str]]:
        """Return every object UUID grouped by durable ``doc_id``."""
        return self._get_object_uuids_by_property(col, "doc_id", doc_ids)

    def _delete_object_uuids(self, col: Any, object_uuids: list[str]) -> None:
        unique_uuids = list(dict.fromkeys(object_uuids))
        for uuid_batch in batched(unique_uuids, _DELETE_BATCH_SIZE):
            self._delete_many_checked(col, Filter.by_id().contains_any(list(uuid_batch)))

    def _raise_for_batch_failures(self, col: Any) -> None:
        """Raise when Weaviate reports object-level batch insertion errors."""
        failed_objects = list(col.batch.failed_objects)
        if not failed_objects:
            return

        messages = [failed_object.message for failed_object in failed_objects[:3]]
        details = "; ".join(messages)
        raise RuntimeError(f"Weaviate failed to insert {len(failed_objects)} object(s): {details}")

    def _delete_many_checked(self, col: Any, where: FilterReturn) -> None:
        """Delete matching objects and surface Weaviate's partial failures."""
        result = col.data.delete_many(where=where, verbose=True)
        failed = result.failed
        if failed > 0:
            raise RuntimeError(
                f"Weaviate failed to delete {failed} of {result.matches} matching object(s) "
                f"from collection {self._collection_name}"
            )

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

        col = self._client.collections.use(self._collection_name)
        object_uuids = self._get_object_uuids_by_property(col, key, [value]).get(value, set())
        self._delete_object_uuids(col, list(object_uuids))

    @override
    def delete(self):
        """Deletes the entire collection from Weaviate."""
        if self._client.collections.exists(self._collection_name):
            self._client.collections.delete(self._collection_name)

    @override
    def text_exists(self, id: str) -> bool:
        """Checks if a document with the given doc_id exists in the collection."""
        if not self._client.collections.exists(self._collection_name):
            return False

        col = self._client.collections.use(self._collection_name)
        return bool(self._get_object_uuids_by_doc_id(col, [id]).get(id))

    @override
    def delete_by_ids(self, ids: list[str]) -> None:
        """
        Deletes objects by their durable metadata ``doc_id`` values.

        Historical Weaviate objects used content-derived object UUIDs, while the
        application persisted ``doc_id`` as the deletion handle. Property-based
        deletion therefore supports both historical objects and new summaries
        whose object UUID is the same as ``doc_id``.
        """
        unique_ids = list(dict.fromkeys(identifier for identifier in ids if identifier))
        if not unique_ids or not self._client.collections.exists(self._collection_name):
            return

        col = self._client.collections.use(self._collection_name)
        object_uuids = self._get_object_uuids_by_doc_id(col, unique_ids)
        self._delete_object_uuids(
            col,
            [object_uuid for doc_id in unique_ids for object_uuid in object_uuids.get(doc_id, set())],
        )

    @override
    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        """
        Performs vector similarity search using the provided query vector.

        Filters by document IDs if provided and applies score threshold.
        Returns documents sorted by relevance score.
        """
        if not self._client.collections.exists(self._collection_name):
            return []

        col = self._client.collections.use(self._collection_name)
        props = list({*self._attributes, self._DOCUMENT_ID_PROPERTY, Field.TEXT_KEY.value})

        where = self._build_search_filter(kwargs)

        top_k = int(kwargs.get("top_k", 4))
        if top_k <= 0:
            return []
        score_threshold = float(kwargs.get("score_threshold") or 0.0)

        docs: list[Document] = []
        offset = 0
        while len(docs) < top_k:
            try:
                res = col.query.near_vector(
                    near_vector=query_vector,
                    limit=top_k,
                    offset=offset,
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
                    offset=offset,
                    return_properties=props,
                    return_metadata=MetadataQuery(distance=True),
                    include_vector=False,
                    filters=where,
                    target_vector="default",
                )

            objects = list(res.objects or [])
            score_threshold_reached = False
            for obj in objects:
                properties = dict(obj.properties or {})
                if obj.metadata and obj.metadata.distance is not None:
                    distance = obj.metadata.distance
                else:
                    distance = 1.0
                score = 1.0 - distance
                if score <= score_threshold:
                    score_threshold_reached = True
                    break
                if not self._matches_search_scope(properties, kwargs):
                    continue
                text_value = properties.pop(Field.TEXT_KEY.value, "")
                text = text_value if isinstance(text_value, str) else str(text_value or "")
                properties["score"] = score
                docs.append(Document(page_content=text, metadata=properties))
                if len(docs) == top_k:
                    break

            if len(docs) == top_k or score_threshold_reached or len(objects) < top_k:
                break
            offset += len(objects)

        return docs

    @override
    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        """
        Performs BM25 full-text search on document content.

        Filters by document IDs if provided and returns matching documents with vectors.
        """
        if not self._client.collections.exists(self._collection_name):
            return []

        col = self._client.collections.use(self._collection_name)
        props = list({*self._attributes, Field.TEXT_KEY.value})

        where = self._build_search_filter(kwargs)

        top_k = int(kwargs.get("top_k", 4))
        if top_k <= 0:
            return []

        docs: list[Document] = []
        offset = 0
        while len(docs) < top_k:
            try:
                res = col.query.bm25(
                    query=query,
                    query_properties=[Field.TEXT_KEY.value],
                    limit=top_k,
                    offset=offset,
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
                    offset=offset,
                    return_properties=props,
                    include_vector=True,
                    filters=where,
                )

            objects = list(res.objects or [])
            for obj in objects:
                properties = dict(obj.properties or {})
                if not self._matches_search_scope(properties, kwargs):
                    continue
                text_value = properties.pop(Field.TEXT_KEY.value, "")
                text = text_value if isinstance(text_value, str) else str(text_value or "")

                raw_vector = obj.vector
                if isinstance(raw_vector, dict):
                    raw_vector = raw_vector.get("default") or next(iter(raw_vector.values()), None)
                vector = _normalize_result_vector(raw_vector)

                docs.append(Document(page_content=text, vector=vector, metadata=properties))
                if len(docs) == top_k:
                    break

            if len(docs) == top_k or len(objects) < top_k:
                break
            offset += len(objects)
        return docs

    def _json_serializable(self, value: Any) -> Any:
        """Converts values to JSON-serializable format, handling datetime objects."""
        if isinstance(value, datetime.datetime):
            return value.isoformat()
        return value


class WeaviateVectorFactory(AbstractVectorFactory):
    """Factory class for creating WeaviateVector instances."""

    @override
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> WeaviateVector:
        """
        Initializes a WeaviateVector instance for the given dataset.

        Uses existing collection name from dataset index structure or generates a new one.
        Updates dataset index structure if not already set.
        """
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
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
        )
