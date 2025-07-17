import json
import logging
import queue
import threading
import uuid
from typing import Any, Optional

import clickzetta  # type: ignore
from pydantic import BaseModel, model_validator

from configs import dify_config
from core.rag.datasource.vdb.field import Field
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from models.dataset import Dataset

logger = logging.getLogger(__name__)


# ClickZetta Lakehouse Vector Database Configuration


class ClickzettaConfig(BaseModel):
    """
    Configuration class for Clickzetta connection.
    """

    username: str
    password: str
    instance: str
    service: str = "api.clickzetta.com"
    workspace: str = "quick_start"
    vcluster: str = "default_ap"
    schema: str = "dify"
    # Advanced settings
    batch_size: int = 100
    enable_inverted_index: bool = True  # Enable inverted index for full-text search
    analyzer_type: str = "chinese"  # Analyzer type for full-text search: keyword, english, chinese, unicode
    analyzer_mode: str = "smart"  # Analyzer mode: max_word, smart
    vector_distance_function: str = "cosine_distance"  # l2_distance or cosine_distance

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict) -> dict:
        """
        Validate the configuration values.
        """
        if not values.get("username"):
            raise ValueError("config CLICKZETTA_USERNAME is required")
        if not values.get("password"):
            raise ValueError("config CLICKZETTA_PASSWORD is required")
        if not values.get("instance"):
            raise ValueError("config CLICKZETTA_INSTANCE is required")
        if not values.get("service"):
            raise ValueError("config CLICKZETTA_SERVICE is required")
        if not values.get("workspace"):
            raise ValueError("config CLICKZETTA_WORKSPACE is required")
        if not values.get("vcluster"):
            raise ValueError("config CLICKZETTA_VCLUSTER is required")
        if not values.get("schema"):
            raise ValueError("config CLICKZETTA_SCHEMA is required")
        return values


class ClickzettaVector(BaseVector):
    """
    Clickzetta vector storage implementation.
    """
    
    # Class-level write queue and lock for serializing writes
    _write_queue: Optional[queue.Queue] = None
    _write_thread: Optional[threading.Thread] = None
    _write_lock = threading.Lock()
    _shutdown = False

    def __init__(self, collection_name: str, config: ClickzettaConfig):
        super().__init__(collection_name)
        self._config = config
        self._table_name = collection_name.replace("-", "_").lower()  # Ensure valid table name
        self._connection = None
        self._init_connection()
        self._init_write_queue()

    def _init_connection(self):
        """Initialize Clickzetta connection."""
        self._connection = clickzetta.connect(
            username=self._config.username,
            password=self._config.password,
            instance=self._config.instance,
            service=self._config.service,
            workspace=self._config.workspace,
            vcluster=self._config.vcluster,
            schema=self._config.schema
        )
    
    @classmethod
    def _init_write_queue(cls):
        """Initialize the write queue and worker thread."""
        with cls._write_lock:
            if cls._write_queue is None:
                cls._write_queue = queue.Queue()
                cls._write_thread = threading.Thread(target=cls._write_worker, daemon=True)
                cls._write_thread.start()
                logger.info("Started Clickzetta write worker thread")
    
    @classmethod
    def _write_worker(cls):
        """Worker thread that processes write tasks sequentially."""
        while not cls._shutdown:
            try:
                # Get task from queue with timeout
                task = cls._write_queue.get(timeout=1)
                if task is None:  # Shutdown signal
                    break
                
                # Execute the write task
                func, args, kwargs, result_queue = task
                try:
                    result = func(*args, **kwargs)
                    result_queue.put((True, result))
                except Exception as e:
                    logger.exception("Write task failed")
                    result_queue.put((False, e))
                finally:
                    cls._write_queue.task_done()
            except queue.Empty:
                continue
            except Exception as e:
                logger.exception("Write worker error")
    
    def _execute_write(self, func, *args, **kwargs):
        """Execute a write operation through the queue."""
        if ClickzettaVector._write_queue is None:
            raise RuntimeError("Write queue not initialized")
        
        result_queue = queue.Queue()
        ClickzettaVector._write_queue.put((func, args, kwargs, result_queue))
        
        # Wait for result
        success, result = result_queue.get()
        if not success:
            raise result
        return result

    def get_type(self) -> str:
        """Return the vector database type."""
        return "clickzetta"

    def _table_exists(self) -> bool:
        """Check if the table exists."""
        try:
            with self._connection.cursor() as cursor:
                cursor.execute(f"DESC {self._config.schema}.{self._table_name}")
                return True
        except Exception as e:
            if "table or view not found" in str(e).lower():
                return False
            else:
                # Re-raise if it's a different error
                raise

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        """Create the collection and add initial documents."""
        # Execute table creation through write queue to avoid concurrent conflicts
        self._execute_write(self._create_table_and_indexes, embeddings)
        
        # Add initial texts
        if texts:
            self.add_texts(texts, embeddings, **kwargs)
    
    def _create_table_and_indexes(self, embeddings: list[list[float]]):
        """Create table and indexes (executed in write worker thread)."""
        # Check if table already exists to avoid unnecessary index creation
        if self._table_exists():
            logger.info(f"Table {self._config.schema}.{self._table_name} already exists, skipping creation")
            return
            
        # Create table with vector and metadata columns
        dimension = len(embeddings[0]) if embeddings else 768

        create_table_sql = f"""
        CREATE TABLE IF NOT EXISTS {self._config.schema}.{self._table_name} (
            id STRING NOT NULL,
            {Field.CONTENT_KEY.value} STRING NOT NULL,
            {Field.METADATA_KEY.value} JSON,
            {Field.VECTOR.value} VECTOR(FLOAT, {dimension}) NOT NULL,
            PRIMARY KEY (id)
        )
        """

        with self._connection.cursor() as cursor:
            cursor.execute(create_table_sql)
            logger.info(f"Created table {self._config.schema}.{self._table_name}")

            # Create vector index
            self._create_vector_index(cursor)

            # Create inverted index for full-text search if enabled
            if self._config.enable_inverted_index:
                self._create_inverted_index(cursor)

    def _create_vector_index(self, cursor):
        """Create HNSW vector index for similarity search."""
        # Use a fixed index name based on table and column name
        index_name = f"idx_{self._table_name}_vector"
        
        # First check if an index already exists on this column
        try:
            cursor.execute(f"SHOW INDEX FROM {self._config.schema}.{self._table_name}")
            existing_indexes = cursor.fetchall()
            for idx in existing_indexes:
                # Check if vector index already exists on the embedding column
                if Field.VECTOR.value in str(idx).lower():
                    logger.info(f"Vector index already exists on column {Field.VECTOR.value}")
                    return
        except Exception as e:
            logger.warning(f"Failed to check existing indexes: {e}")
        
        index_sql = f"""
        CREATE VECTOR INDEX IF NOT EXISTS {index_name}
        ON TABLE {self._config.schema}.{self._table_name}({Field.VECTOR.value})
        PROPERTIES (
            "distance.function" = "{self._config.vector_distance_function}",
            "scalar.type" = "f32",
            "m" = "16",
            "ef.construction" = "128"
        )
        """
        try:
            cursor.execute(index_sql)
            logger.info(f"Created vector index: {index_name}")
        except Exception as e:
            error_msg = str(e).lower()
            if ("already exists" in error_msg or 
                "already has index" in error_msg or 
                "with the same type" in error_msg):
                logger.info(f"Vector index already exists: {e}")
            else:
                logger.exception("Failed to create vector index")
                raise

    def _create_inverted_index(self, cursor):
        """Create inverted index for full-text search."""
        # Use a fixed index name based on table name to avoid duplicates
        index_name = f"idx_{self._table_name}_text"
        
        # Check if an inverted index already exists on this column
        try:
            cursor.execute(f"SHOW INDEX FROM {self._config.schema}.{self._table_name}")
            existing_indexes = cursor.fetchall()
            for idx in existing_indexes:
                idx_str = str(idx).lower()
                # More precise check: look for inverted index specifically on the content column
                if ("inverted" in idx_str and 
                    Field.CONTENT_KEY.value.lower() in idx_str and
                    (index_name.lower() in idx_str or f"idx_{self._table_name}_text" in idx_str)):
                    logger.info(f"Inverted index already exists on column {Field.CONTENT_KEY.value}: {idx}")
                    return
        except Exception as e:
            logger.warning(f"Failed to check existing indexes: {e}")
        
        index_sql = f"""
        CREATE INVERTED INDEX IF NOT EXISTS {index_name}
        ON TABLE {self._config.schema}.{self._table_name} ({Field.CONTENT_KEY.value})
        PROPERTIES (
            "analyzer" = "{self._config.analyzer_type}",
            "mode" = "{self._config.analyzer_mode}"
        )
        """
        try:
            cursor.execute(index_sql)
            logger.info(f"Created inverted index: {index_name}")
        except Exception as e:
            error_msg = str(e).lower()
            # Handle ClickZetta specific error messages
            if (("already exists" in error_msg or 
                "already has index" in error_msg or 
                "with the same type" in error_msg or
                "cannot create inverted index" in error_msg) and
                "already has index" in error_msg):
                logger.info(f"Inverted index already exists on column {Field.CONTENT_KEY.value}")
                # Try to get the existing index name for logging
                try:
                    cursor.execute(f"SHOW INDEX FROM {self._config.schema}.{self._table_name}")
                    existing_indexes = cursor.fetchall()
                    for idx in existing_indexes:
                        if "inverted" in str(idx).lower() and Field.CONTENT_KEY.value.lower() in str(idx).lower():
                            logger.info(f"Found existing inverted index: {idx}")
                            break
                except Exception:
                    pass
            else:
                logger.warning(f"Failed to create inverted index: {e}")
                # Continue without inverted index - full-text search will fall back to LIKE


    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        """Add documents with embeddings to the collection."""
        if not documents:
            return

        batch_size = self._config.batch_size
        total_batches = (len(documents) + batch_size - 1) // batch_size

        for i in range(0, len(documents), batch_size):
            batch_docs = documents[i:i + batch_size]
            batch_embeddings = embeddings[i:i + batch_size]
            
            # Execute batch insert through write queue
            self._execute_write(self._insert_batch, batch_docs, batch_embeddings, i, batch_size, total_batches)
    
    def _insert_batch(self, batch_docs: list[Document], batch_embeddings: list[list[float]], 
                      batch_index: int, batch_size: int, total_batches: int):
        """Insert a batch of documents (executed in write worker thread)."""
        # Prepare batch insert
        values = []
        for doc, embedding in zip(batch_docs, batch_embeddings):
            doc_id = doc.metadata.get("doc_id", str(uuid.uuid4()))
            # For JSON column in Clickzetta, use JSON 'json_string' format
            metadata_json = json.dumps(doc.metadata).replace("'", "''")  # Escape single quotes
            embedding_str = f"VECTOR({','.join(map(str, embedding))})"
            values.append(f"('{doc_id}', '{self._escape_string(doc.page_content)}', "
                        f"JSON '{metadata_json}', {embedding_str})")

        # Use regular INSERT - primary key will handle duplicates
        insert_sql = f"""
        INSERT INTO {self._config.schema}.{self._table_name}
        (id, {Field.CONTENT_KEY.value}, {Field.METADATA_KEY.value}, {Field.VECTOR.value})
        VALUES {','.join(values)}
        """
        
        with self._connection.cursor() as cursor:
            cursor.execute(insert_sql)
            logger.info(f"Inserted batch {batch_index // batch_size + 1}/{total_batches}")

    def text_exists(self, id: str) -> bool:
        """Check if a document exists by ID."""
        with self._connection.cursor() as cursor:
            cursor.execute(
                f"SELECT COUNT(*) FROM {self._config.schema}.{self._table_name} WHERE id = '{id}'"
            )
            result = cursor.fetchone()
            return result[0] > 0 if result else False

    def delete_by_ids(self, ids: list[str]) -> None:
        """Delete documents by IDs."""
        if not ids:
            return

        # Check if table exists before attempting delete
        if not self._table_exists():
            logger.warning(f"Table {self._config.schema}.{self._table_name} does not exist, skipping delete")
            return

        # Execute delete through write queue
        self._execute_write(self._delete_by_ids_impl, ids)
    
    def _delete_by_ids_impl(self, ids: list[str]) -> None:
        """Implementation of delete by IDs (executed in write worker thread)."""
        ids_str = ",".join(f"'{id}'" for id in ids)
        with self._connection.cursor() as cursor:
            cursor.execute(
                f"DELETE FROM {self._config.schema}.{self._table_name} WHERE id IN ({ids_str})"
            )

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        """Delete documents by metadata field."""
        # Check if table exists before attempting delete
        if not self._table_exists():
            logger.warning(f"Table {self._config.schema}.{self._table_name} does not exist, skipping delete")
            return

        # Execute delete through write queue
        self._execute_write(self._delete_by_metadata_field_impl, key, value)
    
    def _delete_by_metadata_field_impl(self, key: str, value: str) -> None:
        """Implementation of delete by metadata field (executed in write worker thread)."""
        with self._connection.cursor() as cursor:
            # Using JSON path to filter
            cursor.execute(
                f"DELETE FROM {self._config.schema}.{self._table_name} "
                f"WHERE {Field.METADATA_KEY.value}->>'$.{key}' = '{value}'"
            )

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        """Search for documents by vector similarity."""
        top_k = kwargs.get("top_k", 10)
        score_threshold = kwargs.get("score_threshold", 0.0)
        document_ids_filter = kwargs.get("document_ids_filter")

        # Build filter clause
        filter_clauses = []
        if document_ids_filter:
            doc_ids_str = ",".join(f"'{id}'" for id in document_ids_filter)
            filter_clauses.append(f"{Field.METADATA_KEY.value}->>'$.document_id' IN ({doc_ids_str})")

        # Add distance threshold based on distance function
        if self._config.vector_distance_function == "cosine_distance":
            # For cosine distance, smaller is better (0 = identical, 2 = opposite)
            distance_func = "COSINE_DISTANCE"
            if score_threshold > 0:
                filter_clauses.append(f"{distance_func}({Field.VECTOR.value}, "
                                    f"VECTOR({','.join(map(str, query_vector))})) < {2 - score_threshold}")
        else:
            # For L2 distance, smaller is better
            distance_func = "L2_DISTANCE"
            if score_threshold > 0:
                filter_clauses.append(f"{distance_func}({Field.VECTOR.value}, "
                                    f"VECTOR({','.join(map(str, query_vector))})) < {score_threshold}")

        where_clause = " AND ".join(filter_clauses) if filter_clauses else "1=1"

        # Execute vector search query
        search_sql = f"""
        SELECT id, {Field.CONTENT_KEY.value}, {Field.METADATA_KEY.value},
               {distance_func}({Field.VECTOR.value}, VECTOR({','.join(map(str, query_vector))})) AS distance
        FROM {self._config.schema}.{self._table_name}
        WHERE {where_clause}
        ORDER BY distance
        LIMIT {top_k}
        """

        documents = []
        with self._connection.cursor() as cursor:
            cursor.execute(search_sql)
            results = cursor.fetchall()

            for row in results:
                metadata = json.loads(row[2]) if row[2] else {}
                # Convert distance to score (inverse for better intuition)
                if self._config.vector_distance_function == "cosine_distance":
                    # Cosine distance to similarity: 1 - (distance / 2)
                    metadata["score"] = 1 - (row[3] / 2)
                else:
                    # L2 distance to score (arbitrary conversion)
                    metadata["score"] = 1 / (1 + row[3])

                doc = Document(page_content=row[1], metadata=metadata)
                documents.append(doc)

        return documents

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        """Search for documents using full-text search with inverted index."""
        if not self._config.enable_inverted_index:
            logger.warning("Full-text search is not enabled. Enable inverted index in config.")
            return []

        top_k = kwargs.get("top_k", 10)
        document_ids_filter = kwargs.get("document_ids_filter")

        # Build filter clause
        filter_clauses = []
        if document_ids_filter:
            doc_ids_str = ",".join(f"'{id}'" for id in document_ids_filter)
            filter_clauses.append(f"{Field.METADATA_KEY.value}->>'$.document_id' IN ({doc_ids_str})")

        # Use match_all function for full-text search
        # match_all requires all terms to be present
        filter_clauses.append(f"MATCH_ALL({Field.CONTENT_KEY.value}, '{self._escape_string(query)}')")

        where_clause = " AND ".join(filter_clauses)

        # Execute full-text search query
        search_sql = f"""
        SELECT id, {Field.CONTENT_KEY.value}, {Field.METADATA_KEY.value}
        FROM {self._config.schema}.{self._table_name}
        WHERE {where_clause}
        LIMIT {top_k}
        """

        documents = []
        with self._connection.cursor() as cursor:
            try:
                cursor.execute(search_sql)
                results = cursor.fetchall()

                for row in results:
                    metadata = json.loads(row[2]) if row[2] else {}
                    # Add a relevance score for full-text search
                    metadata["score"] = 1.0  # Clickzetta doesn't provide relevance scores
                    doc = Document(page_content=row[1], metadata=metadata)
                    documents.append(doc)
            except Exception as e:
                logger.exception("Full-text search failed")
                # Fallback to LIKE search if full-text search fails
                return self._search_by_like(query, **kwargs)

        return documents

    def _search_by_like(self, query: str, **kwargs: Any) -> list[Document]:
        """Fallback search using LIKE operator."""
        top_k = kwargs.get("top_k", 10)
        document_ids_filter = kwargs.get("document_ids_filter")

        # Build filter clause
        filter_clauses = []
        if document_ids_filter:
            doc_ids_str = ",".join(f"'{id}'" for id in document_ids_filter)
            filter_clauses.append(f"{Field.METADATA_KEY.value}->>'$.document_id' IN ({doc_ids_str})")

        filter_clauses.append(f"{Field.CONTENT_KEY.value} LIKE '%{self._escape_string(query)}%'")
        where_clause = " AND ".join(filter_clauses)

        search_sql = f"""
        SELECT id, {Field.CONTENT_KEY.value}, {Field.METADATA_KEY.value}
        FROM {self._config.schema}.{self._table_name}
        WHERE {where_clause}
        LIMIT {top_k}
        """

        documents = []
        with self._connection.cursor() as cursor:
            cursor.execute(search_sql)
            results = cursor.fetchall()

            for row in results:
                metadata = json.loads(row[2]) if row[2] else {}
                metadata["score"] = 0.5  # Lower score for LIKE search
                doc = Document(page_content=row[1], metadata=metadata)
                documents.append(doc)

        return documents

    def delete(self) -> None:
        """Delete the entire collection."""
        with self._connection.cursor() as cursor:
            cursor.execute(f"DROP TABLE IF EXISTS {self._config.schema}.{self._table_name}")

    def _escape_string(self, s: str) -> str:
        """Escape single quotes in strings for SQL."""
        return s.replace("'", "''")


class ClickzettaVectorFactory(AbstractVectorFactory):
    """Factory for creating Clickzetta vector instances."""

    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> BaseVector:
        """Initialize a Clickzetta vector instance."""
        # Get configuration from environment variables or dataset config
        config = ClickzettaConfig(
            username=dify_config.CLICKZETTA_USERNAME,
            password=dify_config.CLICKZETTA_PASSWORD,
            instance=dify_config.CLICKZETTA_INSTANCE,
            service=dify_config.CLICKZETTA_SERVICE,
            workspace=dify_config.CLICKZETTA_WORKSPACE,
            vcluster=dify_config.CLICKZETTA_VCLUSTER,
            schema=dify_config.CLICKZETTA_SCHEMA,
            batch_size=dify_config.CLICKZETTA_BATCH_SIZE or 100,
            enable_inverted_index=dify_config.CLICKZETTA_ENABLE_INVERTED_INDEX or True,
            analyzer_type=dify_config.CLICKZETTA_ANALYZER_TYPE or "chinese",
            analyzer_mode=dify_config.CLICKZETTA_ANALYZER_MODE or "smart",
            vector_distance_function=dify_config.CLICKZETTA_VECTOR_DISTANCE_FUNCTION or "cosine_distance",
        )

        # Use dataset collection name as table name
        collection_name = Dataset.gen_collection_name_by_id(dataset.id).lower()

        return ClickzettaVector(collection_name=collection_name, config=config)
