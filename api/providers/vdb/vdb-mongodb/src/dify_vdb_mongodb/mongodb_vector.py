import json
import logging
import time
from typing import Any
from urllib.parse import urlparse

from pymongo import MongoClient
from pymongo.errors import (
    ConfigurationError,
    ConnectionFailure,
    OperationFailure,
    ServerSelectionTimeoutError,
    WriteError,
)
from pymongo.operations import SearchIndexModel

from configs import dify_config
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from models.dataset import Dataset

logger = logging.getLogger(__name__)

MONGODB_NAMESPACE_EXISTS = 48
MONGODB_INDEX_ALREADY_EXISTS = 68
MONGODB_PERMISSION_DENIED = 13


def _sanitize_uri_for_logging(uri: str | None) -> str:
    """Mask credentials in a MongoDB URI so it is safe to log."""
    if not uri or not isinstance(uri, str) or not uri.strip() or "://" not in uri:
        return "***"

    try:
        parsed = urlparse(uri)
        host_part = parsed.hostname or ""
        if parsed.port:
            host_part += f":{parsed.port}"

        if parsed.username:
            netloc = f"{parsed.username}:***@{host_part}"
        else:
            netloc = host_part

        sanitized = f"{parsed.scheme}://{netloc}"
        if parsed.path:
            sanitized += parsed.path
        return sanitized
    except (ValueError, AttributeError, TypeError):
        return "***"


class MongoDBVector(BaseVector):
    def __init__(self, collection_name: str, group_id: str, config: Any):
        super().__init__(collection_name)
        self._config = config
        self._group_id = group_id

        uri = config.MONGODB_CONNECT_URI
        sanitized_uri = _sanitize_uri_for_logging(uri)
        logger.info(
            "Initializing MongoDBVector: collection='%s', database='%s', index='%s', uri='%s'",
            collection_name,
            config.MONGODB_DATABASE,
            config.MONGODB_VECTOR_INDEX_NAME,
            sanitized_uri,
        )

        client_kwargs: dict[str, Any] = {}
        if config.MONGODB_SERVER_SELECTION_TIMEOUT_MS > 0:
            client_kwargs["serverSelectionTimeoutMS"] = config.MONGODB_SERVER_SELECTION_TIMEOUT_MS

        try:
            self._client: MongoClient = MongoClient(uri, **client_kwargs)  # type: ignore[type-arg]
        except (ConfigurationError, ValueError, TypeError) as e:
            raise ValueError(
                f"Failed to create MongoDB client: {e}. URI: {sanitized_uri}. "
                "Please verify your MongoDB connection settings."
            ) from e

        self._check_connection()
        self._db = self._client[config.MONGODB_DATABASE]
        self._collection = self._db[collection_name]
        self._index_name = config.MONGODB_VECTOR_INDEX_NAME

    def _check_connection(self) -> None:
        """Verify MongoDB connection with configurable retry logic and exponential backoff."""
        max_retries: int = self._config.MONGODB_CONNECTION_RETRY_ATTEMPTS
        sanitized_uri = _sanitize_uri_for_logging(self._config.MONGODB_CONNECT_URI)

        if max_retries == 0:
            try:
                self._client.admin.command("ping")
                return
            except (ConnectionFailure, ServerSelectionTimeoutError):
                logger.exception("MongoDB connection failed (retries disabled). URI: %s", sanitized_uri)
                raise

        backoff_base: float = self._config.MONGODB_CONNECTION_RETRY_BACKOFF_BASE
        max_wait: float = self._config.MONGODB_CONNECTION_RETRY_MAX_WAIT
        last_exception: BaseException | None = None

        for attempt in range(max_retries):
            try:
                self._client.admin.command("ping")
                if attempt > 0:
                    logger.info("MongoDB connection successful after %d attempts", attempt + 1)
                return
            except (ConnectionFailure, ServerSelectionTimeoutError) as e:
                last_exception = e
                if attempt < max_retries - 1:
                    wait_time = min(backoff_base * (2**attempt), max_wait)
                    logger.warning(
                        "MongoDB connection attempt %d/%d failed: %s. Retrying in %.2fs…",
                        attempt + 1,
                        max_retries,
                        e,
                        wait_time,
                    )
                    time.sleep(wait_time)
                else:
                    logger.exception(
                        "Failed to connect to MongoDB after %d attempts. URI: %s",
                        max_retries,
                        sanitized_uri,
                    )

        if last_exception is not None:
            raise last_exception
        raise ConnectionFailure(f"Connection check failed after {max_retries} attempts. URI: {sanitized_uri}")

    def get_type(self) -> str:
        return VectorType.MONGODB

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs: Any) -> None:
        self._create_collection()
        if texts:
            if not embeddings:
                raise ValueError("Embeddings must be provided and non-empty when texts are provided.")
            if any(not embedding for embedding in embeddings):
                raise ValueError("All embeddings must be non-empty when texts are provided.")
            self._create_vector_index(len(embeddings[0]))
            self.add_texts(texts, embeddings, **kwargs)

    def _create_collection(self) -> None:
        try:
            if self._collection.name not in self._db.list_collection_names():
                self._db.create_collection(self._collection.name)
        except OperationFailure as e:
            if getattr(e, "code", None) != MONGODB_NAMESPACE_EXISTS:
                raise

    def _create_vector_index(self, vector_size: int) -> None:
        if vector_size <= 0:
            raise ValueError(f"Invalid vector_size: {vector_size}. Must be > 0.")

        model = SearchIndexModel(
            definition={
                "fields": [
                    {
                        "type": "vector",
                        "path": "embedding",
                        "numDimensions": vector_size,
                        "similarity": "cosine",
                    },
                    {"type": "filter", "path": "group_id"},
                    {"type": "filter", "path": "metadata.doc_id"},
                    {"type": "filter", "path": "metadata.document_id"},
                ]
            },
            name=self._index_name,
            type="vectorSearch",
        )

        try:
            self._collection.create_search_index(model=model)
        except OperationFailure as e:
            error_code = getattr(e, "code", None)
            if (
                error_code == MONGODB_INDEX_ALREADY_EXISTS
                or "IndexAlreadyExists" in str(e)
                or "DuplicateIndexName" in str(e)
            ):
                logger.info("Index '%s' already exists, skipping creation.", self._index_name)
                self._wait_for_index_ready()
                return
            raise

        self._wait_for_index_ready()

    def _wait_for_index_ready(self) -> None:
        timeout: int = self._config.MONGODB_INDEX_READY_TIMEOUT
        delay: float = self._config.MONGODB_INDEX_READY_CHECK_DELAY
        max_delay: float = self._config.MONGODB_INDEX_READY_MAX_DELAY

        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                indexes = list(self._collection.aggregate([{"$listSearchIndexes": {"name": self._index_name}}]))
                for index in indexes:
                    if index.get("queryable") is True and index.get("status") == "READY":
                        return
                    if index.get("status") == "FAILED":
                        raise OperationFailure(
                            f"Index '{self._index_name}' build failed: {index.get('error', 'Unknown error')}"
                        )
            except OperationFailure as e:
                if getattr(e, "code", None) == MONGODB_PERMISSION_DENIED:
                    raise
                logger.warning("Error checking index status: %s. Retrying…", e)
            except (ConnectionFailure, ServerSelectionTimeoutError) as e:
                logger.warning("Connection error checking index status: %s. Retrying…", e)

            time.sleep(delay)
            delay = min(delay * 1.5, max_delay)

        raise TimeoutError(f"Index '{self._index_name}' not ready within {timeout} seconds.")

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs: Any) -> list[str]:
        if not documents or not embeddings:
            return []

        if len(documents) != len(embeddings):
            raise ValueError(f"Mismatch between documents ({len(documents)}) and embeddings ({len(embeddings)}) count")

        docs = []
        doc_ids = []
        for i, doc in enumerate(documents):
            doc_id = doc.metadata.get("doc_id")
            if not doc_id:
                raise ValueError("Each document must include metadata['doc_id']")

            docs.append(
                {
                    "text": doc.page_content,
                    "embedding": embeddings[i],
                    "metadata": doc.metadata,
                    "group_id": self._group_id,
                }
            )
            doc_ids.append(str(doc_id))

        try:
            self._collection.insert_many(docs)
            return doc_ids
        except (WriteError, OperationFailure):
            logger.exception("Failed to insert documents into MongoDB")
            raise

    def text_exists(self, id: str) -> bool:
        return self._collection.find_one({"metadata.doc_id": id, "group_id": self._group_id}) is not None

    def delete_by_ids(self, ids: list[str]) -> None:
        self._collection.delete_many({"metadata.doc_id": {"$in": ids}, "group_id": self._group_id})

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        self._collection.delete_many({f"metadata.{key}": value, "group_id": self._group_id})

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        if not query_vector:
            return []

        filter_dict: dict[str, Any] = {"group_id": self._group_id}

        document_ids_filter = kwargs.get("document_ids_filter")
        if document_ids_filter:
            filter_dict["metadata.document_id"] = {"$in": document_ids_filter}

        pipeline: list[dict[str, Any]] = [
            {
                "$vectorSearch": {
                    "index": self._index_name,
                    "path": "embedding",
                    "queryVector": query_vector,
                    "numCandidates": kwargs.get("top_k", 4) * 10,
                    "limit": kwargs.get("top_k", 4),
                    "filter": filter_dict,
                }
            },
            {"$project": {"text": 1, "metadata": 1, "score": {"$meta": "vectorSearchScore"}}},
        ]

        results = self._collection.aggregate(pipeline)
        documents = self._results_to_documents(results)

        score_threshold = kwargs.get("score_threshold")
        if score_threshold is None:
            return documents

        try:
            score_threshold = float(score_threshold)
        except (TypeError, ValueError) as exc:
            raise ValueError("score_threshold must be a numeric value") from exc
        return [doc for doc in documents if doc.metadata.get("score", 0.0) >= score_threshold]

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        # Atlas Search full-text is not yet implemented; return empty results.
        return []

    def delete(self) -> None:
        self._collection.delete_many({"group_id": self._group_id})

    def _results_to_documents(self, results: Any) -> list[Document]:
        documents = []
        for res in results:
            metadata = res.get("metadata")
            if not metadata or not isinstance(metadata, dict):
                metadata = {}
            metadata["score"] = res.get("score", 0.0)
            documents.append(
                Document(
                    page_content=res.get("text", ""),
                    metadata=metadata,
                )
            )
        return documents


class MongoDBVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> MongoDBVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.MONGODB, collection_name))

        return MongoDBVector(
            collection_name=collection_name,
            group_id=dataset.id,
            config=dify_config,
        )
