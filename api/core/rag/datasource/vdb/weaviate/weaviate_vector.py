"""
Weaviate vector database implementation for Dify's RAG system.

This module provides integration with Weaviate vector database for storing and retrieving
document embeddings used in retrieval-augmented generation workflows.
"""

import datetime
import json
import logging
import uuid as _uuid
from typing import Any
from urllib.parse import urlparse

import weaviate
import weaviate.classes.config as wc
from pydantic import BaseModel, model_validator
from weaviate.classes.data import DataObject
from weaviate.classes.init import Auth
from weaviate.classes.query import Filter, MetadataQuery
from weaviate.exceptions import UnexpectedStatusCodeError

from configs import dify_config
from core.rag.datasource.vdb.field import Field
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)


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
    def validate_config(cls, values: dict) -> dict:
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
        p = urlparse(config.endpoint)
        host = p.hostname or config.endpoint.replace("https://", "").replace("http://", "")
        http_secure = p.scheme == "https"
        http_port = p.port or (443 if http_secure else 80)

        # Parse gRPC configuration
        if config.grpc_endpoint:
            # Urls without scheme won't be parsed correctly in some python verions,
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

        return client

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

    def to_index_struct(self) -> dict:
        """Returns the index structure dictionary for persistence."""
        return {"type": self.get_type(), "vector_store": {"class_prefix": self._collection_name}}

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
                    self._client.collections.create(
                        name=self._collection_name,
                        properties=[
                            wc.Property(
                                name=Field.TEXT_KEY.value,
                                data_type=wc.DataType.TEXT,
                                tokenization=wc.Tokenization.WORD,
                            ),
                            wc.Property(name="document_id", data_type=wc.DataType.TEXT),
                            wc.Property(name="doc_id", data_type=wc.DataType.TEXT),
                            wc.Property(name="chunk_index", data_type=wc.DataType.INT),
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
            to_add.append(wc.Property(name="document_id", data_type=wc.DataType.TEXT))
        if "doc_id" not in existing:
            to_add.append(wc.Property(name="doc_id", data_type=wc.DataType.TEXT))
        if "chunk_index" not in existing:
            to_add.append(wc.Property(name="chunk_index", data_type=wc.DataType.INT))

        for prop in to_add:
            try:
                col.config.add_property(prop)
            except Exception as e:
                logger.warning("Could not add property %s: %s", prop.name, e)

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

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        """
        Adds documents with their embeddings to the collection.

        Batches insertions for efficiency and returns the list of inserted object IDs.
        """
        uuids = self._get_uuids(documents)
        texts = [d.page_content for d in documents]
        metadatas = [d.metadata for d in documents]

        col = self._client.collections.use(self._collection_name)
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

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        """Deletes all objects matching a specific metadata field value."""
        if not self._client.collections.exists(self._collection_name):
            return

        col = self._client.collections.use(self._collection_name)
        col.data.delete_many(where=Filter.by_property(key).equal(value))

    def delete(self):
        """Deletes the entire collection from Weaviate."""
        if self._client.collections.exists(self._collection_name):
            self._client.collections.delete(self._collection_name)

    def text_exists(self, id: str) -> bool:
        """Checks if a document with the given doc_id exists in the collection."""
        if not self._client.collections.exists(self._collection_name):
            return False

        col = self._client.collections.use(self._collection_name)
        res = col.query.fetch_objects(
            filters=Filter.by_property("doc_id").equal(id),
            limit=1,
            return_properties=["doc_id"],
        )

        return len(res.objects) > 0

    def delete_by_ids(self, ids: list[str]) -> None:
        """
        Deletes objects by their UUID identifiers.

        Silently ignores 404 errors for non-existent IDs.
        """
        if not self._client.collections.exists(self._collection_name):
            return

        col = self._client.collections.use(self._collection_name)

        for uid in ids:
            try:
                col.data.delete_by_id(uid)
            except UnexpectedStatusCodeError as e:
                if getattr(e, "status_code", None) != 404:
                    raise

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        """
        Performs vector similarity search using the provided query vector.

        Filters by document IDs if provided and applies score threshold.
        Returns documents sorted by relevance score.
        """
        if not self._client.collections.exists(self._collection_name):
            return []

        col = self._client.collections.use(self._collection_name)
        props = list({*self._attributes, "document_id", Field.TEXT_KEY.value})

        where = None
        doc_ids = kwargs.get("document_ids_filter") or []
        if doc_ids:
            ors = [Filter.by_property("document_id").equal(x) for x in doc_ids]
            where = ors[0]
            for f in ors[1:]:
                where = where | f

        top_k = int(kwargs.get("top_k", 4))
        score_threshold = float(kwargs.get("score_threshold") or 0.0)

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

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        """
        Performs BM25 full-text search on document content.

        Filters by document IDs if provided and returns matching documents with vectors.
        """
        if not self._client.collections.exists(self._collection_name):
            return []

        col = self._client.collections.use(self._collection_name)
        props = list({*self._attributes, Field.TEXT_KEY.value})

        where = None
        doc_ids = kwargs.get("document_ids_filter") or []
        if doc_ids:
            ors = [Filter.by_property("document_id").equal(x) for x in doc_ids]
            where = ors[0]
            for f in ors[1:]:
                where = where | f

        top_k = int(kwargs.get("top_k", 4))

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
