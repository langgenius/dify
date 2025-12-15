import logging
import time
from typing import TYPE_CHECKING, Any

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
from core.rag.models.document import Document
from models.dataset import Dataset

if TYPE_CHECKING:
    from core.rag.embedding.embedding_base import Embeddings

logger = logging.getLogger(__name__)


class MongoDBVector(BaseVector):
    def __init__(self, collection_name: str, group_id: str, config):
        super().__init__(collection_name)
        uri = config.MONGODB_CONNECT_URI
        logger.info(
            f"Initializing MongoDBVector with collection '{collection_name}', "
            f"database '{config.MONGODB_DATABASE}', index '{config.MONGODB_VECTOR_INDEX_NAME}'"
        )
        
        try:
            self._client = MongoClient(uri, serverSelectionTimeoutMS=5000)
            self._check_connection()
        except (ConnectionFailure, ServerSelectionTimeoutError) as e:
            logger.error(
                f"Failed to connect to MongoDB at initialization. "
                f"URI: {self._sanitize_uri(uri)}, Error: {e}",
                exc_info=True
            )
            raise
        except ConfigurationError as e:
            logger.error(
                f"Invalid MongoDB configuration. URI: {self._sanitize_uri(uri)}, Error: {e}",
                exc_info=True
            )
            raise
        except Exception as e:
            logger.error(
                f"Unexpected error when connecting to MongoDB. URI: {self._sanitize_uri(uri)}, Error: {e}",
                exc_info=True
            )
            raise
        
        self._db = self._client[config.MONGODB_DATABASE]
        self._collection = self._db[collection_name]
        self._index_name = config.MONGODB_VECTOR_INDEX_NAME
        self._group_id = group_id
        logger.info(f"MongoDBVector initialized successfully for collection '{collection_name}'")

    @staticmethod
    def _sanitize_uri(uri: str) -> str:
        """
        Sanitize MongoDB URI for logging by removing credentials.
        
        Args:
            uri: MongoDB connection URI
            
        Returns:
            URI with credentials masked
        """
        if not uri:
            return "***"
        
        # Mask password in URI
        if "@" in uri:
            parts = uri.split("@")
            if len(parts) == 2:
                auth_part = parts[0]
                if "://" in auth_part:
                    scheme_part = auth_part.split("://")[0]
                    credentials = auth_part.split("://")[1]
                    if ":" in credentials:
                        username = credentials.split(":")[0]
                        return f"{scheme_part}://{username}:***@{parts[1]}"
        
        return uri

    def _check_connection(self):
        """
        Verify MongoDB connection and check permissions.
        
        Raises:
            ConnectionFailure: If connection fails
            OperationFailure: If permission check fails
        """
        try:
            # Simple ping command to verify connection
            self._client.admin.command('ping')
            logger.debug("MongoDB connection ping successful")
        except (ConnectionFailure, ServerSelectionTimeoutError) as e:
            logger.error(
                f"Failed to connect to MongoDB: {e}. "
                "Please check if MongoDB is running and accessible.",
                exc_info=True
            )
            raise
        except OperationFailure as e:
            # Check for authentication/permission errors
            error_code = getattr(e, "code", None)
            error_msg = str(e).lower()
            
            if error_code in [18, 13] or "authentication" in error_msg or "unauthorized" in error_msg:
                logger.error(
                    f"MongoDB authentication failed: {e}. "
                    "Please check your credentials and user permissions.",
                    exc_info=True
                )
                raise ConnectionFailure(f"Authentication failed: {e}") from e
            
            if "not authorized" in error_msg or "access denied" in error_msg:
                logger.error(
                    f"MongoDB permission denied: {e}. "
                    "Please check user permissions for the database.",
                    exc_info=True
                )
                raise OperationFailure(f"Permission denied: {e}") from e
            
            logger.error(f"MongoDB operation failed during connection check: {e}", exc_info=True)
            raise
        except Exception as e:
            logger.error(f"Unexpected error when checking MongoDB connection: {e}", exc_info=True)
            raise

    def get_type(self) -> str:
        return VectorType.MONGODB

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        self._create_collection()
        if texts:
            self._create_vector_index(len(embeddings[0]))
            self.add_texts(texts, embeddings, **kwargs)

    def _create_collection(self):
        """
        Create MongoDB collection if it doesn't exist.
        
        Raises:
            OperationFailure: If collection creation fails due to permissions or other errors
        """
        try:
            collection_names = self._db.list_collection_names()
            if self._collection.name not in collection_names:
                logger.info(f"Creating collection '{self._collection.name}' in database '{self._db.name}'")
                self._db.create_collection(self._collection.name)
                logger.info(f"Collection '{self._collection.name}' created successfully")
            else:
                logger.debug(f"Collection '{self._collection.name}' already exists")
        except OperationFailure as e:
            error_code = getattr(e, "code", None)
            error_msg = str(e).lower()
            
            if error_code in [13] or "not authorized" in error_msg or "access denied" in error_msg:
                logger.error(
                    f"Permission denied when creating collection '{self._collection.name}': {e}. "
                    "Please check user permissions for database operations.",
                    exc_info=True
                )
                raise OperationFailure(f"Permission denied: {e}") from e
            
            logger.error(
                f"Failed to create collection '{self._collection.name}': {e}",
                exc_info=True
            )
            raise
        except Exception as e:
            logger.error(
                f"Unexpected error when creating collection '{self._collection.name}': {e}",
                exc_info=True
            )
            raise

    def _create_vector_index(self, vector_size: int):
        """
        Create vector search index in MongoDB.
        
        Args:
            vector_size: Dimension of the vector embeddings
            
        Raises:
            OperationFailure: If index creation fails due to permissions or other errors
            ValueError: If vector_size is invalid
        """
        if vector_size <= 0:
            raise ValueError(f"Invalid vector_size: {vector_size}. Must be greater than 0.")
        
        logger.info(
            f"Creating vector search index '{self._index_name}' with {vector_size} dimensions "
            f"for collection '{self._collection.name}'"
        )
        
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
            logger.info(f"Vector search index '{self._index_name}' creation initiated")
        except OperationFailure as e:
            error_code = getattr(e, "code", None)
            error_msg = str(e)
            
            # Handle index already exists cases
            if (
                error_code == 68
                or "IndexAlreadyExists" in error_msg
                or "DuplicateIndexName" in error_msg
                or "already exists" in error_msg.lower()
            ):
                logger.info(
                    f"Index '{self._index_name}' already exists. Skipping creation. "
                    f"Error details: {e}"
                )
                # Still wait for index to be ready in case it's still building
                self._wait_for_index_ready()
                return
            
            # Handle permission errors
            if error_code in [13] or "not authorized" in error_msg.lower() or "access denied" in error_msg.lower():
                logger.error(
                    f"Permission denied when creating index '{self._index_name}': {e}. "
                    "Please check user permissions for index creation operations.",
                    exc_info=True
                )
                raise OperationFailure(f"Permission denied: {e}") from e
            
            # Handle other OperationFailure errors
            logger.error(
                f"Failed to create index '{self._index_name}': {e}. "
                f"Error code: {error_code}",
                exc_info=True
            )
            raise
        except Exception as e:
            logger.error(
                f"Unexpected error when creating index '{self._index_name}': {e}",
                exc_info=True
            )
            raise

        self._wait_for_index_ready()

    def _wait_for_index_ready(self, timeout: int = 300):
        """
        Wait for vector search index to become ready.
        
        Args:
            timeout: Maximum time to wait in seconds (default: 300)
            
        Raises:
            TimeoutError: If index is not ready within timeout
            OperationFailure: If index build fails or permission errors occur
        """
        start_time = time.time()
        # Exponential backoff parameters
        delay = 1.0
        max_delay = 10.0
        check_count = 0
        
        logger.info(f"Waiting for index '{self._index_name}' to become ready (timeout: {timeout}s)")
        
        while time.time() - start_time < timeout:
            try:
                cursor = self._collection.aggregate([{"$listSearchIndexes": {"name": self._index_name}}])
                indexes = list(cursor)
                
                if not indexes:
                    logger.warning(
                        f"Index '{self._index_name}' not found. It may still be creating. "
                        f"Retrying in {delay:.1f}s..."
                    )
                else:
                    for index in indexes:
                        status = index.get("status")
                        queryable = index.get("queryable")
                        
                        if queryable is True and status == "READY":
                            elapsed = time.time() - start_time
                            logger.info(
                                f"Index '{self._index_name}' is ready after {elapsed:.1f}s"
                            )
                            return
                        
                        if status == "FAILED":
                            error_msg = index.get("error", "Unknown error")
                            logger.error(
                                f"Index '{self._index_name}' build failed: {error_msg}",
                                exc_info=True
                            )
                            raise OperationFailure(
                                f"Index '{self._index_name}' build failed: {error_msg}"
                            )
                        
                        # Log status periodically
                        if check_count % 10 == 0:
                            logger.debug(
                                f"Index '{self._index_name}' status: {status}, "
                                f"queryable: {queryable}, elapsed: {time.time() - start_time:.1f}s"
                            )
                
            except OperationFailure as e:
                error_code = getattr(e, "code", None)
                error_msg = str(e).lower()
                
                # Check for permission errors
                if error_code in [13] or "not authorized" in error_msg or "access denied" in error_msg:
                    logger.error(
                        f"Permission denied when checking index status for '{self._index_name}': {e}",
                        exc_info=True
                    )
                    raise OperationFailure(f"Permission denied: {e}") from e
                
                logger.warning(
                    f"Error checking index status for '{self._index_name}': {e}. Retrying in {delay:.1f}s...",
                    exc_info=False
                )
            except Exception as e:
                logger.warning(
                    f"Unexpected error when checking index status for '{self._index_name}': {e}. "
                    f"Retrying in {delay:.1f}s...",
                    exc_info=False
                )
            
            check_count += 1
            time.sleep(delay)
            # Increase delay with exponential backoff, capped at max_delay
            delay = min(delay * 1.5, max_delay)
        
        elapsed = time.time() - start_time
        logger.error(
            f"Index '{self._index_name}' not ready within {timeout} seconds (elapsed: {elapsed:.1f}s)"
        )
        raise TimeoutError(
            f"Index '{self._index_name}' not ready within {timeout} seconds. "
            "Please check MongoDB logs for index build status."
        )

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        """
        Add documents with embeddings to the MongoDB collection.
        
        Args:
            documents: List of Document objects
            embeddings: List of embedding vectors
            **kwargs: Additional keyword arguments
            
        Raises:
            WriteError: If write operation fails due to permissions or validation errors
            OperationFailure: If operation fails for other reasons
        """
        if not documents or not embeddings:
            logger.warning("No documents or embeddings provided to add_texts")
            return
        
        if len(documents) != len(embeddings):
            raise ValueError(
                f"Mismatch between documents ({len(documents)}) and "
                f"embeddings ({len(embeddings)}) count"
            )
        
        logger.debug(
            f"Adding {len(documents)} documents to collection '{self._collection.name}'"
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
                result = self._collection.insert_many(docs)
                logger.info(
                    f"Successfully inserted {len(result.inserted_ids)} documents into "
                    f"collection '{self._collection.name}'"
                )
        except WriteError as e:
            error_code = getattr(e, "code", None)
            error_msg = str(e).lower()
            
            if error_code in [13] or "not authorized" in error_msg or "access denied" in error_msg:
                logger.error(
                    f"Permission denied when inserting documents into '{self._collection.name}': {e}. "
                    "Please check user write permissions.",
                    exc_info=True
                )
                raise WriteError(f"Permission denied: {e}") from e
            
            logger.error(
                f"Write error when inserting documents into '{self._collection.name}': {e}",
                exc_info=True
            )
            raise
        except OperationFailure as e:
            error_code = getattr(e, "code", None)
            error_msg = str(e).lower()
            
            if error_code in [13] or "not authorized" in error_msg or "access denied" in error_msg:
                logger.error(
                    f"Permission denied when inserting documents into '{self._collection.name}': {e}",
                    exc_info=True
                )
                raise OperationFailure(f"Permission denied: {e}") from e
            
            logger.error(
                f"Operation failed when inserting documents into '{self._collection.name}': {e}",
                exc_info=True
            )
            raise
        except Exception as e:
            logger.error(
                f"Unexpected error when inserting documents into '{self._collection.name}': {e}",
                exc_info=True
            )
            raise

    def text_exists(self, id: str) -> bool:
        return self._collection.find_one({"metadata.doc_id": id, "group_id": self._group_id}) is not None

    def delete_by_ids(self, ids: list[str]):
        """
        Delete documents by their IDs.
        
        Args:
            ids: List of document IDs to delete
            
        Raises:
            OperationFailure: If delete operation fails
        """
        if not ids:
            logger.warning("No IDs provided to delete_by_ids")
            return
        
        logger.debug(
            f"Deleting {len(ids)} documents by IDs from collection '{self._collection.name}'"
        )
        
        try:
            result = self._collection.delete_many(
                {"metadata.doc_id": {"$in": ids}, "group_id": self._group_id}
            )
            logger.info(
                f"Deleted {result.deleted_count} documents from '{self._collection.name}'"
            )
        except OperationFailure as e:
            error_code = getattr(e, "code", None)
            error_msg = str(e).lower()
            
            if error_code in [13] or "not authorized" in error_msg or "access denied" in error_msg:
                logger.error(
                    f"Permission denied when deleting from '{self._collection.name}': {e}. "
                    "Please check user write permissions.",
                    exc_info=True
                )
                raise OperationFailure(f"Permission denied: {e}") from e
            
            logger.error(
                f"Delete operation failed in '{self._collection.name}': {e}",
                exc_info=True
            )
            raise
        except Exception as e:
            logger.error(
                f"Unexpected error when deleting from '{self._collection.name}': {e}",
                exc_info=True
            )
            raise

    def delete_by_metadata_field(self, key: str, value: str):
        """
        Delete documents by metadata field.
        
        Args:
            key: Metadata field key
            value: Metadata field value
            
        Raises:
            OperationFailure: If delete operation fails
        """
        if not key or not value:
            logger.warning(f"Invalid key or value provided to delete_by_metadata_field: key={key}, value={value}")
            return
        
        logger.debug(
            f"Deleting documents by metadata field '{key}={value}' from collection '{self._collection.name}'"
        )
        
        try:
            result = self._collection.delete_many(
                {f"metadata.{key}": value, "group_id": self._group_id}
            )
            logger.info(
                f"Deleted {result.deleted_count} documents with metadata '{key}={value}' "
                f"from '{self._collection.name}'"
            )
        except OperationFailure as e:
            error_code = getattr(e, "code", None)
            error_msg = str(e).lower()
            
            if error_code in [13] or "not authorized" in error_msg or "access denied" in error_msg:
                logger.error(
                    f"Permission denied when deleting from '{self._collection.name}': {e}. "
                    "Please check user write permissions.",
                    exc_info=True
                )
                raise OperationFailure(f"Permission denied: {e}") from e
            
            logger.error(
                f"Delete operation failed in '{self._collection.name}': {e}",
                exc_info=True
            )
            raise
        except Exception as e:
            logger.error(
                f"Unexpected error when deleting from '{self._collection.name}': {e}",
                exc_info=True
            )
            raise

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        """
        Search for similar vectors in MongoDB.
        
        Args:
            query_vector: Query embedding vector
            **kwargs: Additional search parameters (top_k, filter, document_ids_filter)
            
        Returns:
            List of Document objects sorted by similarity
            
        Raises:
            OperationFailure: If search operation fails
        """
        if not query_vector:
            logger.warning("Empty query vector provided to search_by_vector")
            return []
        
        top_k = kwargs.get("top_k", 4)
        logger.debug(
            f"Searching for top {top_k} similar vectors in collection '{self._collection.name}'"
        )
        
        try:
            pipeline = self._get_search_pipeline(query_vector, **kwargs)
            results = self._collection.aggregate(pipeline)
            documents = self._results_to_documents(results)
            logger.debug(
                f"Found {len(documents)} results from vector search in '{self._collection.name}'"
            )
            return documents
        except OperationFailure as e:
            error_code = getattr(e, "code", None)
            error_msg = str(e).lower()
            
            if error_code in [13] or "not authorized" in error_msg or "access denied" in error_msg:
                logger.error(
                    f"Permission denied when searching in '{self._collection.name}': {e}. "
                    "Please check user read permissions.",
                    exc_info=True
                )
                raise OperationFailure(f"Permission denied: {e}") from e
            
            logger.error(
                f"Search operation failed in '{self._collection.name}': {e}",
                exc_info=True
            )
            raise
        except Exception as e:
            logger.error(
                f"Unexpected error when searching in '{self._collection.name}': {e}",
                exc_info=True
            )
            raise

    def _get_search_pipeline(self, query_vector: list[float], **kwargs: Any) -> list[dict]:
        filter_dict = {"group_id": self._group_id}
        
        # Merge additional filters if provided
        if kwargs.get("filter"):
            # This is naive merging, real implementation might need to handle complex filters
            pass
            
        # Support common document_ids_filter from Dify
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
        """
        Delete all documents for this group_id.
        
        Raises:
            OperationFailure: If delete operation fails
        """
        logger.info(
            f"Deleting all documents for group_id '{self._group_id}' from collection '{self._collection.name}'"
        )
        
        try:
            result = self._collection.delete_many({"group_id": self._group_id})
            logger.info(
                f"Deleted {result.deleted_count} documents for group_id '{self._group_id}' "
                f"from '{self._collection.name}'"
            )
        except OperationFailure as e:
            error_code = getattr(e, "code", None)
            error_msg = str(e).lower()
            
            if error_code in [13] or "not authorized" in error_msg or "access denied" in error_msg:
                logger.error(
                    f"Permission denied when deleting from '{self._collection.name}': {e}. "
                    "Please check user write permissions.",
                    exc_info=True
                )
                raise OperationFailure(f"Permission denied: {e}") from e
            
            logger.error(
                f"Delete operation failed in '{self._collection.name}': {e}",
                exc_info=True
            )
            raise
        except Exception as e:
            logger.error(
                f"Unexpected error when deleting from '{self._collection.name}': {e}",
                exc_info=True
            )
            raise

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
