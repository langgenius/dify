import logging
import time
from typing import TYPE_CHECKING, Any
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

from configs.middleware.vdb.mongodb_config import MongoDBErrorCode
from configs import dify_config
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.models.document import Document
from models.dataset import Dataset

if TYPE_CHECKING:
    from core.rag.embedding.embedding_base import Embeddings

logger = logging.getLogger(__name__)


def _sanitize_uri_for_logging(uri: str) -> str:
    """
    Sanitize MongoDB URI for safe logging by masking all credentials.
    
    This function ensures no passwords or sensitive information are logged.
    It handles various URI formats including mongodb:// and mongodb+srv://.
    
    Args:
        uri: MongoDB connection URI
        
    Returns:
        URI with all credentials masked (e.g., mongodb://user:***@host:port)
        Returns "***" if URI cannot be safely sanitized
    """
    if not uri or not isinstance(uri, str) or not uri.strip() or "://" not in uri:
        return "***"
    
    try:
        parsed = urlparse(uri)
        
        # Build sanitized URI
        if parsed.username:
            # Has authentication - mask password
            masked_netloc = f"{parsed.username}:***@"
            if parsed.hostname:
                masked_netloc += parsed.hostname
            if parsed.port:
                masked_netloc += f":{parsed.port}"
            
            sanitized = f"{parsed.scheme}://{masked_netloc}"
            if parsed.path:
                sanitized += parsed.path
            if parsed.query:
                sanitized += f"?{parsed.query}"
            if parsed.fragment:
                sanitized += f"#{parsed.fragment}"
            return sanitized
        else:
            # No authentication
            masked_netloc = parsed.hostname or ""
            if parsed.port:
                masked_netloc += f":{parsed.port}"
            sanitized = f"{parsed.scheme}://{masked_netloc}"
            if parsed.path:
                sanitized += parsed.path
            if parsed.query:
                sanitized += f"?{parsed.query}"
            if parsed.fragment:
                sanitized += f"#{parsed.fragment}"
            return sanitized
            
    except (ValueError, AttributeError, TypeError):
        # If parsing fails, return safe default
        return "***"


class MongoDBVector(BaseVector):
    def __init__(self, collection_name: str, group_id: str, config):
        super().__init__(collection_name)
        self._config = config
        
        # Get URI with consistent exception handling
        try:
            uri = config.MONGODB_CONNECT_URI
        except ValueError as e:
            # ValueError from config indicates configuration issue
            logger.error(f"Invalid MongoDB configuration: {e}")
            raise
        except (AttributeError, RuntimeError) as e:
            # AttributeError: property access issue, RuntimeError: unexpected runtime issue
            error_msg = (
                f"Failed to get MongoDB connection URI: {e} (type: {type(e).__name__}). "
                f"Please check your MongoDB configuration settings."
            )
            logger.error(error_msg, exc_info=True)
            raise ValueError(error_msg) from e
        
        # Always sanitize URI before logging
        sanitized_uri = _sanitize_uri_for_logging(uri)
        logger.info(
            f"Initializing MongoDBVector: collection='{collection_name}', "
            f"database='{config.MONGODB_DATABASE}', index='{config.MONGODB_VECTOR_INDEX_NAME}', "
            f"uri='{sanitized_uri}'"
        )
        
        client_kwargs = {}
        if config.MONGODB_SERVER_SELECTION_TIMEOUT_MS > 0:
            client_kwargs["serverSelectionTimeoutMS"] = config.MONGODB_SERVER_SELECTION_TIMEOUT_MS
        
        try:
            self._client = MongoClient(uri, **client_kwargs)
        except (ConfigurationError, ValueError, TypeError) as e:
            # ConfigurationError: invalid MongoDB configuration
            # ValueError: invalid URI format
            # TypeError: invalid parameter types
            error_msg = (
                f"Failed to create MongoDB client: {e} (type: {type(e).__name__}). "
                f"URI: {sanitized_uri}. "
                f"Please verify your MongoDB connection settings."
            )
            logger.error(error_msg, exc_info=True)
            raise ValueError(error_msg) from e
        
        # Check connection with transparent retry logic
        self._check_connection()
        self._db = self._client[config.MONGODB_DATABASE]
        self._collection = self._db[collection_name]
        self._index_name = config.MONGODB_VECTOR_INDEX_NAME
        self._group_id = group_id
        logger.debug(f"MongoDBVector initialized successfully for collection '{collection_name}'")

    def _check_connection(self):
        """
        Verify MongoDB connection with configurable retry logic for transient errors.
        
        Uses exponential backoff with base delay from config, capped at maximum wait time.
        Retries are useful for:
        - Network transient failures
        - Server startup delays
        - Temporary connection pool exhaustion
        
        Set MONGODB_CONNECTION_RETRY_ATTEMPTS to 0 to disable retries (fail immediately).
        Set to 1 for a single attempt with no retries.
        
        All connection attempts and failures are logged for transparency.
        Total retry time is tracked and reported on failure to help diagnose performance issues.
        
        Raises:
            ConnectionFailure: If connection fails after all retries
            ServerSelectionTimeoutError: If server selection times out after all retries
            ValueError: If retry configuration is invalid
        """
        max_retries = self._config.MONGODB_CONNECTION_RETRY_ATTEMPTS
        
        if not isinstance(max_retries, int) or max_retries < 0:
            raise ValueError(
                f"MONGODB_CONNECTION_RETRY_ATTEMPTS must be a non-negative integer. "
                f"Received: {max_retries} (type: {type(max_retries).__name__})"
            )
        
        # Track timing for performance transparency
        start_time = time.time()
        sanitized_uri = _sanitize_uri_for_logging(self._config.MONGODB_CONNECT_URI)
        
        if max_retries == 0:
            # No retries - fail immediately
            try:
                self._client.admin.command('ping')
                elapsed = time.time() - start_time
                logger.debug(f"MongoDB connection successful (no retries, elapsed: {elapsed:.2f}s)")
                return
            except (ConnectionFailure, ServerSelectionTimeoutError) as e:
                elapsed = time.time() - start_time
                logger.error(
                    f"MongoDB connection failed (retries disabled, elapsed: {elapsed:.2f}s): {e}. "
                    f"URI: {sanitized_uri}"
                )
                raise
            except (RuntimeError, OSError) as e:
                # RuntimeError: unexpected runtime issues (e.g., client already closed)
                # OSError: system-level errors (e.g., network issues not caught by pymongo)
                elapsed = time.time() - start_time
                error_msg = (
                    f"Connection check failed: {e} (type: {type(e).__name__}). "
                    f"Elapsed: {elapsed:.2f}s. URI: {sanitized_uri}"
                )
                logger.error(error_msg, exc_info=True)
                raise ConnectionFailure(error_msg) from e
        
        # Retry logic with exponential backoff
        backoff_base = self._config.MONGODB_CONNECTION_RETRY_BACKOFF_BASE
        max_wait = self._config.MONGODB_CONNECTION_RETRY_MAX_WAIT
        
        if not isinstance(backoff_base, (int, float)) or backoff_base <= 0:
            raise ValueError(
                f"MONGODB_CONNECTION_RETRY_BACKOFF_BASE must be a positive number. "
                f"Received: {backoff_base} (type: {type(backoff_base).__name__})"
            )
        
        if not isinstance(max_wait, (int, float)) or max_wait <= 0:
            raise ValueError(
                f"MONGODB_CONNECTION_RETRY_MAX_WAIT must be a positive number. "
                f"Received: {max_wait} (type: {type(max_wait).__name__})"
            )
        
        last_exception = None
        total_wait_time = 0.0
        
        for attempt in range(max_retries):
            try:
                self._client.admin.command('ping')
                elapsed = time.time() - start_time
                if attempt > 0:
                    logger.info(
                        f"MongoDB connection successful after {attempt + 1} attempts "
                        f"(total elapsed: {elapsed:.2f}s, wait time: {total_wait_time:.2f}s). "
                        f"URI: {sanitized_uri}"
                    )
                else:
                    logger.debug(f"MongoDB connection successful (elapsed: {elapsed:.2f}s)")
                return
            except (ConnectionFailure, ServerSelectionTimeoutError) as e:
                last_exception = e
                if attempt < max_retries - 1:
                    wait_time = min(backoff_base * (2 ** attempt), max_wait)
                    total_wait_time += wait_time
                    elapsed = time.time() - start_time
                    logger.warning(
                        f"MongoDB connection attempt {attempt + 1}/{max_retries} failed: {e}. "
                        f"Retrying in {wait_time:.2f}s... "
                        f"(elapsed: {elapsed:.2f}s, total wait: {total_wait_time:.2f}s). "
                        f"URI: {sanitized_uri}"
                    )
                    time.sleep(wait_time)
                else:
                    elapsed = time.time() - start_time
                    logger.error(
                        f"Failed to connect to MongoDB after {max_retries} attempts "
                        f"(total elapsed: {elapsed:.2f}s, total wait: {total_wait_time:.2f}s): {e}. "
                        f"URI: {sanitized_uri}"
                    )
            except (RuntimeError, OSError) as e:
                # RuntimeError: unexpected runtime issues (e.g., client already closed)
                # OSError: system-level errors (e.g., network issues not caught by pymongo)
                # These should not be retried as they indicate non-transient issues
                elapsed = time.time() - start_time
                error_msg = (
                    f"Connection check failed with unexpected error: {e} (type: {type(e).__name__}). "
                    f"Attempt {attempt + 1}/{max_retries}, elapsed: {elapsed:.2f}s, "
                    f"total wait: {total_wait_time:.2f}s. URI: {sanitized_uri}"
                )
                logger.error(error_msg, exc_info=True)
                raise ConnectionFailure(error_msg) from e
        
        # All retries exhausted
        if last_exception is None:
            elapsed = time.time() - start_time
            error_msg = (
                f"Connection check failed with unknown error after {max_retries} attempts "
                f"(elapsed: {elapsed:.2f}s). URI: {sanitized_uri}"
            )
            logger.error(error_msg)
            raise ConnectionFailure(error_msg)
        
        elapsed = time.time() - start_time
        error_msg = (
            f"Failed to connect to MongoDB after {max_retries} attempts "
            f"(total elapsed: {elapsed:.2f}s, total wait: {total_wait_time:.2f}s). "
            f"Last error: {last_exception}. URI: {sanitized_uri}"
        )
        logger.error(error_msg)
        raise last_exception

    def get_type(self) -> str:
        return VectorType.MONGODB

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        self._create_collection()
        if texts:
            self._create_vector_index(len(embeddings[0]))
            self.add_texts(texts, embeddings, **kwargs)

    def _create_collection(self):
        """Create MongoDB collection if it doesn't exist."""
        try:
            if self._collection.name not in self._db.list_collection_names():
                logger.debug(f"Creating collection '{self._collection.name}'")
                self._db.create_collection(self._collection.name)
                logger.debug(f"Collection '{self._collection.name}' created successfully")
        except OperationFailure as e:
            error_code = getattr(e, "code", None)
            if error_code != MongoDBErrorCode.NAMESPACE_EXISTS:
                logger.error(f"Failed to create collection '{self._collection.name}': {e} (error_code: {error_code})")
                raise

    def _create_vector_index(self, vector_size: int):
        if vector_size <= 0:
            raise ValueError(f"Invalid vector_size: {vector_size}. Must be greater than 0.")
        
        logger.debug(f"Creating vector search index '{self._index_name}' with {vector_size} dimensions")
        
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
            logger.debug(f"Vector search index '{self._index_name}' creation initiated")
        except OperationFailure as e:
            error_code = getattr(e, "code", None)
            if error_code == MongoDBErrorCode.INDEX_ALREADY_EXISTS or "IndexAlreadyExists" in str(e) or "DuplicateIndexName" in str(e):
                logger.info(f"Index '{self._index_name}' already exists. Skipping creation.")
                self._wait_for_index_ready()
                return
            else:
                logger.error(
                    f"Failed to create index '{self._index_name}': {e} "
                    f"(error_code: {error_code})"
                )
                raise

        self._wait_for_index_ready()

    def _wait_for_index_ready(self):
        """
        Wait for vector search index to become ready with configurable exponential backoff.
        
        Uses exponential backoff with configurable delays. This is necessary because
        MongoDB vector search indexes are built asynchronously and may take time to
        become queryable, especially for large collections.
        
        Raises:
            TimeoutError: If index is not ready within configured timeout
            OperationFailure: If index build fails or permission denied
            ConnectionFailure: If connection is lost and cannot be recovered
        """
        timeout = self._config.MONGODB_INDEX_READY_TIMEOUT
        delay = self._config.MONGODB_INDEX_READY_CHECK_DELAY
        max_delay = self._config.MONGODB_INDEX_READY_MAX_DELAY
        check_count = 0
        
        start_time = time.time()
        logger.debug(f"Waiting for index '{self._index_name}' to become ready (timeout: {timeout}s)")
        
        while time.time() - start_time < timeout:
            try:
                cursor = self._collection.aggregate([{"$listSearchIndexes": {"name": self._index_name}}])
                indexes = list(cursor)
                
                if not indexes:
                    logger.debug(f"Index '{self._index_name}' not found yet, retrying in {delay:.1f}s...")
                else:
                    for index in indexes:
                        status = index.get("status")
                        queryable = index.get("queryable")
                        
                        if queryable is True and status == "READY":
                            elapsed = time.time() - start_time
                            logger.debug(f"Index '{self._index_name}' is ready after {elapsed:.1f}s")
                            return
                        
                        if status == "FAILED":
                            error_msg = index.get("error", "Unknown error")
                            full_error_msg = f"Index '{self._index_name}' build failed: {error_msg}"
                            logger.error(full_error_msg)
                            # Create OperationFailure with full diagnostic context
                            raise OperationFailure(full_error_msg)
                        
                        if check_count % 10 == 0 and check_count > 0:
                            logger.debug(
                                f"Index '{self._index_name}' status: {status}, "
                                f"queryable: {queryable}, elapsed: {time.time() - start_time:.1f}s"
                            )
                
            except OperationFailure as e:
                error_code = getattr(e, "code", None)
                if error_code == MongoDBErrorCode.PERMISSION_DENIED:
                    error_msg = f"Permission denied when checking index status: {e} (error_code: {error_code})"
                    logger.error(error_msg, exc_info=True)
                    # Preserve original exception with all diagnostic data
                    raise
                if error_code and error_code not in (None, 0):
                    logger.warning(f"Operation error when checking index status: {e} (error_code: {error_code}). Retrying in {delay:.1f}s...")
                else:
                    logger.warning(f"Error checking index status: {e}. Retrying in {delay:.1f}s...")
            except (ConnectionFailure, ServerSelectionTimeoutError) as e:
                logger.warning(
                    f"Connection error when checking index status: {e}. "
                    f"Retrying in {delay:.1f}s..."
                )
            except (RuntimeError, OSError, ValueError) as e:
                # RuntimeError: unexpected runtime issues
                # OSError: system-level errors
                # ValueError: invalid parameters or data
                logger.error(
                    f"Unexpected error when checking index status: {e} (type: {type(e).__name__}). "
                    f"Retrying in {delay:.1f}s...",
                    exc_info=True
                )
            
            check_count += 1
            time.sleep(delay)
            delay = min(delay * 1.5, max_delay)
        
        elapsed = time.time() - start_time
        logger.error(
            f"Index '{self._index_name}' not ready within {timeout}s (elapsed: {elapsed:.1f}s)"
        )
        raise TimeoutError(f"Index '{self._index_name}' not ready within {timeout} seconds.")

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        if not documents or not embeddings:
            return
        
        if len(documents) != len(embeddings):
            raise ValueError(
                f"Mismatch between documents ({len(documents)}) and "
                f"embeddings ({len(embeddings)}) count"
            )
        
        docs = []
        for i, doc in enumerate(documents):
            docs.append(
                {
                    "text": doc.page_content,
                    "embedding": embeddings[i],
                    "metadata": doc.metadata,
                    "group_id": self._group_id,
                }
            )
        
        try:
            if docs:
                self._collection.insert_many(docs)
        except WriteError as e:
            error_code = getattr(e, "code", None)
            error_msg = f"Write error when inserting documents: {e} (error_code: {error_code})"
            logger.error(error_msg, exc_info=True)
            # Preserve original exception with all diagnostic data (error_code, details, etc.)
            raise
        except OperationFailure as e:
            error_code = getattr(e, "code", None)
            error_msg = f"Operation failed when inserting documents: {e} (error_code: {error_code})"
            logger.error(error_msg, exc_info=True)
            # Preserve original exception with all diagnostic data (error_code, details, etc.)
            raise

    def text_exists(self, id: str) -> bool:
        return self._collection.find_one({"metadata.doc_id": id, "group_id": self._group_id}) is not None

    def delete_by_ids(self, ids: list[str]):
        self._collection.delete_many({"metadata.doc_id": {"$in": ids}, "group_id": self._group_id})

    def delete_by_metadata_field(self, key: str, value: str):
        self._collection.delete_many({f"metadata.{key}": value, "group_id": self._group_id})

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        if not query_vector:
            logger.warning("Empty query vector provided to search_by_vector")
            return []
        
        try:
            pipeline = self._get_search_pipeline(query_vector, **kwargs)
            results = self._collection.aggregate(pipeline)
            return self._results_to_documents(results)
        except OperationFailure as e:
            error_code = getattr(e, "code", None)
            error_msg = f"Search operation failed: {e} (error_code: {error_code})"
            logger.error(error_msg, exc_info=True)
            # Preserve original exception with all diagnostic data (error_code, details, etc.)
            raise

    def _get_search_pipeline(self, query_vector: list[float], **kwargs: Any) -> list[dict]:
        filter_dict = {"group_id": self._group_id}
        
        if kwargs.get("filter"):
            # TODO: Implement additional filter logic here using kwargs['filter'] if needed.
            
        document_ids_filter = kwargs.get("document_ids_filter")
        if document_ids_filter:
             filter_dict["metadata.document_id"] = {"$in": document_ids_filter}

        pipeline = [
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
        return pipeline

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        """
        Search by full text.
        
        This method is currently a placeholder and not implemented for MongoDB vector store.
        Future implementations might leverage Atlas Search or text indexes.
        """
        logger.warning("search_by_full_text is not implemented for MongoDBVector. Returning empty results.")
        return []

    def delete(self):
        self._collection.delete_many({"group_id": self._group_id})

    def close(self):
        if self._client:
            self._client.close()

    def __del__(self):
        self.close()

    def _results_to_documents(self, results) -> list[Document]:
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
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: "Embeddings") -> MongoDBVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)

        return MongoDBVector(
            collection_name=collection_name,
            group_id=dataset.id,
            config=dify_config
        )
