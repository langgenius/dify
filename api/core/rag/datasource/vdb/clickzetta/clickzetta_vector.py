import json
import logging
import queue
import threading
import uuid
from typing import TYPE_CHECKING, Any, Optional

import clickzetta  # type: ignore
from pydantic import BaseModel, model_validator

if TYPE_CHECKING:
    from clickzetta import Connection

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
    schema_name: str = "dify"  # Renamed to avoid shadowing BaseModel.schema
    # Advanced settings
    batch_size: int = 20  # Reduced batch size to avoid large SQL statements
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
        if not values.get("schema_name"):
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
        self._connection: Optional[Connection] = None
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
            schema=self._config.schema_name
        )

        # Set session parameters for better string handling and performance optimization
        if self._connection is not None:
            with self._connection.cursor() as cursor:
                # Use quote mode for string literal escaping to handle quotes better
                cursor.execute("SET cz.sql.string.literal.escape.mode = 'quote'")
                logger.info("Set string literal escape mode to 'quote' for better quote handling")

                # Performance optimization hints for vector operations
                self._set_performance_hints(cursor)

    def _set_performance_hints(self, cursor):
        """Set ClickZetta performance optimization hints for vector operations."""
        try:
            # Performance optimization hints for vector operations and query processing
            performance_hints = [
                # Vector index optimization
                "SET cz.storage.parquet.vector.index.read.memory.cache = true",
                "SET cz.storage.parquet.vector.index.read.local.cache = false",

                # Query optimization
                "SET cz.sql.table.scan.push.down.filter = true",
                "SET cz.sql.table.scan.enable.ensure.filter = true",
                "SET cz.storage.always.prefetch.internal = true",
                "SET cz.optimizer.generate.columns.always.valid = true",
                "SET cz.sql.index.prewhere.enabled = true",

                # Storage optimization
                "SET cz.storage.parquet.enable.io.prefetch = false",
                "SET cz.optimizer.enable.mv.rewrite = false",
                "SET cz.sql.dump.as.lz4 = true",
                "SET cz.optimizer.limited.optimization.naive.query = true",
                "SET cz.sql.table.scan.enable.push.down.log = false",
                "SET cz.storage.use.file.format.local.stats = false",
                "SET cz.storage.local.file.object.cache.level = all",

                # Job execution optimization
                "SET cz.sql.job.fast.mode = true",
                "SET cz.storage.parquet.non.contiguous.read = true",
                "SET cz.sql.compaction.after.commit = true"
            ]

            for hint in performance_hints:
                cursor.execute(hint)

            logger.info(
                "Applied %d performance optimization hints for ClickZetta vector operations", 
                len(performance_hints)
            )

        except Exception:
            # Catch any errors setting performance hints but continue with defaults
            logger.exception("Failed to set some performance hints, continuing with default settings")

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
                if cls._write_queue is not None:
                    task = cls._write_queue.get(timeout=1)
                    if task is None:  # Shutdown signal
                        break

                    # Execute the write task
                    func, args, kwargs, result_queue = task
                    try:
                        result = func(*args, **kwargs)
                        result_queue.put((True, result))
                    except (RuntimeError, ValueError, TypeError, ConnectionError) as e:
                        logger.exception("Write task failed")
                        result_queue.put((False, e))
                    finally:
                        cls._write_queue.task_done()
                else:
                    break
            except queue.Empty:
                continue
            except (RuntimeError, ValueError, TypeError, ConnectionError) as e:
                logger.exception("Write worker error")

    def _execute_write(self, func, *args, **kwargs):
        """Execute a write operation through the queue."""
        if ClickzettaVector._write_queue is None:
            raise RuntimeError("Write queue not initialized")

        result_queue: queue.Queue[tuple[bool, Any]] = queue.Queue()
        ClickzettaVector._write_queue.put((func, args, kwargs, result_queue))

        # Wait for result
        success, result = result_queue.get()
        if not success:
            raise result
        return result

    def get_type(self) -> str:
        """Return the vector database type."""
        return "clickzetta"

    def _ensure_connection(self) -> "Connection":
        """Ensure connection is available and return it."""
        if self._connection is None:
            raise RuntimeError("Database connection not initialized")
        return self._connection

    def _table_exists(self) -> bool:
        """Check if the table exists."""
        try:
            connection = self._ensure_connection()
            with connection.cursor() as cursor:
                cursor.execute(f"DESC {self._config.schema_name}.{self._table_name}")
                return True
        except (RuntimeError, ValueError) as e:
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
            logger.info("Table %s.%s already exists, skipping creation", self._config.schema_name, self._table_name)
            return

        # Create table with vector and metadata columns
        dimension = len(embeddings[0]) if embeddings else 768

        create_table_sql = f"""
        CREATE TABLE IF NOT EXISTS {self._config.schema_name}.{self._table_name} (
            id STRING NOT NULL COMMENT 'Unique document identifier',
            {Field.CONTENT_KEY.value} STRING NOT NULL COMMENT 'Document text content for search and retrieval',
            {Field.METADATA_KEY.value} JSON COMMENT 'Document metadata including source, type, and other attributes',
            {Field.VECTOR.value} VECTOR(FLOAT, {dimension}) NOT NULL COMMENT
                'High-dimensional embedding vector for semantic similarity search',
            PRIMARY KEY (id)
        ) COMMENT 'Dify RAG knowledge base vector storage table for document embeddings and content'
        """

        connection = self._ensure_connection()
        with connection.cursor() as cursor:
            cursor.execute(create_table_sql)
            logger.info("Created table %s.%s", self._config.schema_name, self._table_name)

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
            cursor.execute(f"SHOW INDEX FROM {self._config.schema_name}.{self._table_name}")
            existing_indexes = cursor.fetchall()
            for idx in existing_indexes:
                # Check if vector index already exists on the embedding column
                if Field.VECTOR.value in str(idx).lower():
                    logger.info("Vector index already exists on column %s", Field.VECTOR.value)
                    return
        except (RuntimeError, ValueError) as e:
            logger.warning("Failed to check existing indexes: %s", e)

        index_sql = f"""
        CREATE VECTOR INDEX IF NOT EXISTS {index_name}
        ON TABLE {self._config.schema_name}.{self._table_name}({Field.VECTOR.value})
        PROPERTIES (
            "distance.function" = "{self._config.vector_distance_function}",
            "scalar.type" = "f32",
            "m" = "16",
            "ef.construction" = "128"
        )
        """
        try:
            cursor.execute(index_sql)
            logger.info("Created vector index: %s", index_name)
        except (RuntimeError, ValueError) as e:
            error_msg = str(e).lower()
            if ("already exists" in error_msg or
                "already has index" in error_msg or
                "with the same type" in error_msg):
                logger.info("Vector index already exists: %s", e)
            else:
                logger.exception("Failed to create vector index")
                raise

    def _create_inverted_index(self, cursor):
        """Create inverted index for full-text search."""
        # Use a fixed index name based on table name to avoid duplicates
        index_name = f"idx_{self._table_name}_text"

        # Check if an inverted index already exists on this column
        try:
            cursor.execute(f"SHOW INDEX FROM {self._config.schema_name}.{self._table_name}")
            existing_indexes = cursor.fetchall()
            for idx in existing_indexes:
                idx_str = str(idx).lower()
                # More precise check: look for inverted index specifically on the content column
                if ("inverted" in idx_str and
                    Field.CONTENT_KEY.value.lower() in idx_str and
                    (index_name.lower() in idx_str or f"idx_{self._table_name}_text" in idx_str)):
                    logger.info("Inverted index already exists on column %s: %s", Field.CONTENT_KEY.value, idx)
                    return
        except (RuntimeError, ValueError) as e:
            logger.warning("Failed to check existing indexes: %s", e)

        index_sql = f"""
        CREATE INVERTED INDEX IF NOT EXISTS {index_name}
        ON TABLE {self._config.schema_name}.{self._table_name} ({Field.CONTENT_KEY.value})
        PROPERTIES (
            "analyzer" = "{self._config.analyzer_type}",
            "mode" = "{self._config.analyzer_mode}"
        )
        """
        try:
            cursor.execute(index_sql)
            logger.info("Created inverted index: %s", index_name)
        except (RuntimeError, ValueError) as e:
            error_msg = str(e).lower()
            # Handle ClickZetta specific error messages
            if (("already exists" in error_msg or
                "already has index" in error_msg or
                "with the same type" in error_msg or
                "cannot create inverted index" in error_msg) and
                "already has index" in error_msg):
                logger.info("Inverted index already exists on column %s", Field.CONTENT_KEY.value)
                # Try to get the existing index name for logging
                try:
                    cursor.execute(f"SHOW INDEX FROM {self._config.schema_name}.{self._table_name}")
                    existing_indexes = cursor.fetchall()
                    for idx in existing_indexes:
                        if "inverted" in str(idx).lower() and Field.CONTENT_KEY.value.lower() in str(idx).lower():
                            logger.info("Found existing inverted index: %s", idx)
                            break
                except (RuntimeError, ValueError):
                    pass
            else:
                logger.warning("Failed to create inverted index: %s", e)
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
        """Insert a batch of documents using parameterized queries (executed in write worker thread)."""
        if not batch_docs or not batch_embeddings:
            logger.warning("Empty batch provided, skipping insertion")
            return

        if len(batch_docs) != len(batch_embeddings):
            logger.error("Mismatch between docs (%d) and embeddings (%d)", len(batch_docs), len(batch_embeddings))
            return

        # Prepare data for parameterized insertion
        data_rows = []
        vector_dimension = len(batch_embeddings[0]) if batch_embeddings and batch_embeddings[0] else 768

        for doc, embedding in zip(batch_docs, batch_embeddings):
            # Optimized: minimal checks for common case, fallback for edge cases
            metadata = doc.metadata if doc.metadata else {}

            if not isinstance(metadata, dict):
                metadata = {}

            doc_id = self._safe_doc_id(metadata.get("doc_id", str(uuid.uuid4())))

            # Fast path for JSON serialization
            try:
                metadata_json = json.dumps(metadata, ensure_ascii=True)
            except (TypeError, ValueError):
                logger.warning("JSON serialization failed, using empty dict")
                metadata_json = "{}"

            content = doc.page_content or ""

            # According to ClickZetta docs, vector should be formatted as array string
            # for external systems: '[1.0, 2.0, 3.0]'
            vector_str = '[' + ','.join(map(str, embedding)) + ']'
            data_rows.append([doc_id, content, metadata_json, vector_str])

        # Check if we have any valid data to insert
        if not data_rows:
            logger.warning("No valid documents to insert in batch %d/%d", batch_index // batch_size + 1, total_batches)
            return

        # Use parameterized INSERT with executemany for better performance and security
        # Cast JSON and VECTOR in SQL, pass raw data as parameters
        columns = f"id, {Field.CONTENT_KEY.value}, {Field.METADATA_KEY.value}, {Field.VECTOR.value}"
        insert_sql = (
            f"INSERT INTO {self._config.schema_name}.{self._table_name} ({columns}) "
            f"VALUES (?, ?, CAST(? AS JSON), CAST(? AS VECTOR({vector_dimension})))"
        )

        connection = self._ensure_connection()
        with connection.cursor() as cursor:
            try:
                # Set session-level hints for batch insert operations
                # Note: executemany doesn't support hints parameter, so we set them as session variables
                cursor.execute("SET cz.sql.job.fast.mode = true")
                cursor.execute("SET cz.sql.compaction.after.commit = true")
                cursor.execute("SET cz.storage.always.prefetch.internal = true")

                cursor.executemany(insert_sql, data_rows)
                logger.info(
                    "Inserted batch %d/%d (%d valid docs using parameterized query with VECTOR(%d) cast)",
                    batch_index // batch_size + 1, total_batches, len(data_rows), vector_dimension
                )
            except (RuntimeError, ValueError, TypeError, ConnectionError) as e:
                logger.exception("Parameterized SQL execution failed for %d documents", len(data_rows))
                logger.exception("SQL template: %s", insert_sql)
                logger.exception("Sample data row: %s", data_rows[0] if data_rows else 'None')
                raise

    def text_exists(self, id: str) -> bool:
        """Check if a document exists by ID."""
        safe_id = self._safe_doc_id(id)
        connection = self._ensure_connection()
        with connection.cursor() as cursor:
            cursor.execute(
                f"SELECT COUNT(*) FROM {self._config.schema_name}.{self._table_name} WHERE id = ?",
                [safe_id]
            )
            result = cursor.fetchone()
            return result[0] > 0 if result else False

    def delete_by_ids(self, ids: list[str]) -> None:
        """Delete documents by IDs."""
        if not ids:
            return

        # Check if table exists before attempting delete
        if not self._table_exists():
            logger.warning("Table %s.%s does not exist, skipping delete", self._config.schema_name, self._table_name)
            return

        # Execute delete through write queue
        self._execute_write(self._delete_by_ids_impl, ids)

    def _delete_by_ids_impl(self, ids: list[str]) -> None:
        """Implementation of delete by IDs (executed in write worker thread)."""
        safe_ids = [self._safe_doc_id(id) for id in ids]
        # Create properly escaped string literals for SQL
        id_list = ",".join(f"'{id}'" for id in safe_ids)
        sql = f"DELETE FROM {self._config.schema_name}.{self._table_name} WHERE id IN ({id_list})"

        connection = self._ensure_connection()
        with connection.cursor() as cursor:
            cursor.execute(sql)

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        """Delete documents by metadata field."""
        # Check if table exists before attempting delete
        if not self._table_exists():
            logger.warning("Table %s.%s does not exist, skipping delete", self._config.schema_name, self._table_name)
            return

        # Execute delete through write queue
        self._execute_write(self._delete_by_metadata_field_impl, key, value)

    def _delete_by_metadata_field_impl(self, key: str, value: str) -> None:
        """Implementation of delete by metadata field (executed in write worker thread)."""
        connection = self._ensure_connection()
        with connection.cursor() as cursor:
            # Using JSON path to filter with parameterized query
            # Note: JSON path requires literal key name, cannot be parameterized
            # Use json_extract_string function for ClickZetta compatibility
            sql = (f"DELETE FROM {self._config.schema_name}.{self._table_name} "
                   f"WHERE json_extract_string({Field.METADATA_KEY.value}, '$.{key}') = ?")
            cursor.execute(sql, [value])

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        """Search for documents by vector similarity."""
        top_k = kwargs.get("top_k", 10)
        score_threshold = kwargs.get("score_threshold", 0.0)
        document_ids_filter = kwargs.get("document_ids_filter")

        # Handle filter parameter from canvas (workflow)
        filter_param = kwargs.get("filter", {})

        # Build filter clause
        filter_clauses = []
        if document_ids_filter:
            safe_doc_ids = [str(id).replace("'", "''") for id in document_ids_filter]
            doc_ids_str = ",".join(f"'{id}'" for id in safe_doc_ids)
            # Use json_extract_string function for ClickZetta compatibility
            filter_clauses.append(
                f"json_extract_string({Field.METADATA_KEY.value}, '$.document_id') IN ({doc_ids_str})"
            )

        # No need for dataset_id filter since each dataset has its own table

        # Add distance threshold based on distance function
        vector_dimension = len(query_vector)
        if self._config.vector_distance_function == "cosine_distance":
            # For cosine distance, smaller is better (0 = identical, 2 = opposite)
            distance_func = "COSINE_DISTANCE"
            if score_threshold > 0:
                query_vector_str = f"CAST('[{self._format_vector_simple(query_vector)}]' AS VECTOR({vector_dimension}))"
                filter_clauses.append(f"{distance_func}({Field.VECTOR.value}, "
                                    f"{query_vector_str}) < {2 - score_threshold}")
        else:
            # For L2 distance, smaller is better
            distance_func = "L2_DISTANCE"
            if score_threshold > 0:
                query_vector_str = f"CAST('[{self._format_vector_simple(query_vector)}]' AS VECTOR({vector_dimension}))"
                filter_clauses.append(f"{distance_func}({Field.VECTOR.value}, "
                                    f"{query_vector_str}) < {score_threshold}")

        where_clause = " AND ".join(filter_clauses) if filter_clauses else "1=1"

        # Execute vector search query
        query_vector_str = f"CAST('[{self._format_vector_simple(query_vector)}]' AS VECTOR({vector_dimension}))"
        search_sql = f"""
        SELECT id, {Field.CONTENT_KEY.value}, {Field.METADATA_KEY.value},
               {distance_func}({Field.VECTOR.value}, {query_vector_str}) AS distance
        FROM {self._config.schema_name}.{self._table_name}
        WHERE {where_clause}
        ORDER BY distance
        LIMIT {top_k}
        """

        documents = []
        connection = self._ensure_connection()
        with connection.cursor() as cursor:
            # Use hints parameter for vector search optimization
            search_hints = {
                'hints': {
                    'sdk.job.timeout': 60,  # Increase timeout for vector search
                    'cz.sql.job.fast.mode': True,
                    'cz.storage.parquet.vector.index.read.memory.cache': True
                }
            }
            cursor.execute(search_sql, parameters=search_hints)
            results = cursor.fetchall()

            for row in results:
                # Parse metadata from JSON string (may be double-encoded)
                try:
                    if row[2]:
                        metadata = json.loads(row[2])

                        # If result is a string, it's double-encoded JSON - parse again
                        if isinstance(metadata, str):
                            metadata = json.loads(metadata)

                        if not isinstance(metadata, dict):
                            metadata = {}
                    else:
                        metadata = {}
                except (json.JSONDecodeError, TypeError) as e:
                    logger.exception("JSON parsing failed")
                    # Fallback: extract document_id with regex
                    import re
                    doc_id_match = re.search(r'"document_id":\s*"([^"]+)"', str(row[2] or ''))
                    metadata = {"document_id": doc_id_match.group(1)} if doc_id_match else {}

                # Ensure required fields are set
                metadata["doc_id"] = row[0]  # segment id

                # Ensure document_id exists (critical for Dify's format_retrieval_documents)
                if "document_id" not in metadata:
                    metadata["document_id"] = row[0]  # fallback to segment id

                # Add score based on distance
                if self._config.vector_distance_function == "cosine_distance":
                    metadata["score"] = 1 - (row[3] / 2)
                else:
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

        # Handle filter parameter from canvas (workflow)
        filter_param = kwargs.get("filter", {})

        # Build filter clause
        filter_clauses = []
        if document_ids_filter:
            safe_doc_ids = [str(id).replace("'", "''") for id in document_ids_filter]
            doc_ids_str = ",".join(f"'{id}'" for id in safe_doc_ids)
            # Use json_extract_string function for ClickZetta compatibility
            filter_clauses.append(
                f"json_extract_string({Field.METADATA_KEY.value}, '$.document_id') IN ({doc_ids_str})"
            )

        # No need for dataset_id filter since each dataset has its own table

        # Use match_all function for full-text search
        # match_all requires all terms to be present
        # Use simple quote escaping for MATCH_ALL since it needs to be in the WHERE clause
        escaped_query = query.replace("'", "''")
        filter_clauses.append(f"MATCH_ALL({Field.CONTENT_KEY.value}, '{escaped_query}')")

        where_clause = " AND ".join(filter_clauses)

        # Execute full-text search query
        search_sql = f"""
        SELECT id, {Field.CONTENT_KEY.value}, {Field.METADATA_KEY.value}
        FROM {self._config.schema_name}.{self._table_name}
        WHERE {where_clause}
        LIMIT {top_k}
        """

        documents = []
        connection = self._ensure_connection()
        with connection.cursor() as cursor:
            try:
                # Use hints parameter for full-text search optimization
                fulltext_hints = {
                    'hints': {
                        'sdk.job.timeout': 30,  # Timeout for full-text search
                        'cz.sql.job.fast.mode': True,
                        'cz.sql.index.prewhere.enabled': True
                    }
                }
                cursor.execute(search_sql, parameters=fulltext_hints)
                results = cursor.fetchall()

                for row in results:
                    # Parse metadata from JSON string (may be double-encoded)
                    try:
                        if row[2]:
                            metadata = json.loads(row[2])

                            # If result is a string, it's double-encoded JSON - parse again
                            if isinstance(metadata, str):
                                metadata = json.loads(metadata)

                            if not isinstance(metadata, dict):
                                metadata = {}
                        else:
                            metadata = {}
                    except (json.JSONDecodeError, TypeError) as e:
                        logger.exception("JSON parsing failed")
                        # Fallback: extract document_id with regex
                        import re
                        doc_id_match = re.search(r'"document_id":\s*"([^"]+)"', str(row[2] or ''))
                        metadata = {"document_id": doc_id_match.group(1)} if doc_id_match else {}

                    # Ensure required fields are set
                    metadata["doc_id"] = row[0]  # segment id

                    # Ensure document_id exists (critical for Dify's format_retrieval_documents)
                    if "document_id" not in metadata:
                        metadata["document_id"] = row[0]  # fallback to segment id

                    # Add a relevance score for full-text search
                    metadata["score"] = 1.0  # Clickzetta doesn't provide relevance scores
                    doc = Document(page_content=row[1], metadata=metadata)
                    documents.append(doc)
            except (RuntimeError, ValueError, TypeError, ConnectionError) as e:
                logger.exception("Full-text search failed")
                # Fallback to LIKE search if full-text search fails
                return self._search_by_like(query, **kwargs)

        return documents

    def _search_by_like(self, query: str, **kwargs: Any) -> list[Document]:
        """Fallback search using LIKE operator."""
        top_k = kwargs.get("top_k", 10)
        document_ids_filter = kwargs.get("document_ids_filter")

        # Handle filter parameter from canvas (workflow)
        filter_param = kwargs.get("filter", {})

        # Build filter clause
        filter_clauses = []
        if document_ids_filter:
            safe_doc_ids = [str(id).replace("'", "''") for id in document_ids_filter]
            doc_ids_str = ",".join(f"'{id}'" for id in safe_doc_ids)
            # Use json_extract_string function for ClickZetta compatibility
            filter_clauses.append(
                f"json_extract_string({Field.METADATA_KEY.value}, '$.document_id') IN ({doc_ids_str})"
            )

        # No need for dataset_id filter since each dataset has its own table

        # Use simple quote escaping for LIKE clause
        escaped_query = query.replace("'", "''")
        filter_clauses.append(f"{Field.CONTENT_KEY.value} LIKE '%{escaped_query}%'")
        where_clause = " AND ".join(filter_clauses)

        search_sql = f"""
        SELECT id, {Field.CONTENT_KEY.value}, {Field.METADATA_KEY.value}
        FROM {self._config.schema_name}.{self._table_name}
        WHERE {where_clause}
        LIMIT {top_k}
        """

        documents = []
        connection = self._ensure_connection()
        with connection.cursor() as cursor:
            # Use hints parameter for LIKE search optimization
            like_hints = {
                'hints': {
                    'sdk.job.timeout': 20,  # Timeout for LIKE search
                    'cz.sql.job.fast.mode': True
                }
            }
            cursor.execute(search_sql, parameters=like_hints)
            results = cursor.fetchall()

            for row in results:
                # Parse metadata from JSON string (may be double-encoded)
                try:
                    if row[2]:
                        metadata = json.loads(row[2])

                        # If result is a string, it's double-encoded JSON - parse again
                        if isinstance(metadata, str):
                            metadata = json.loads(metadata)

                        if not isinstance(metadata, dict):
                            metadata = {}
                    else:
                        metadata = {}
                except (json.JSONDecodeError, TypeError) as e:
                    logger.exception("JSON parsing failed")
                    # Fallback: extract document_id with regex
                    import re
                    doc_id_match = re.search(r'"document_id":\s*"([^"]+)"', str(row[2] or ''))
                    metadata = {"document_id": doc_id_match.group(1)} if doc_id_match else {}

                # Ensure required fields are set
                metadata["doc_id"] = row[0]  # segment id

                # Ensure document_id exists (critical for Dify's format_retrieval_documents)
                if "document_id" not in metadata:
                    metadata["document_id"] = row[0]  # fallback to segment id

                metadata["score"] = 0.5  # Lower score for LIKE search
                doc = Document(page_content=row[1], metadata=metadata)
                documents.append(doc)

        return documents

    def delete(self) -> None:
        """Delete the entire collection."""
        connection = self._ensure_connection()
        with connection.cursor() as cursor:
            cursor.execute(f"DROP TABLE IF EXISTS {self._config.schema_name}.{self._table_name}")


    def _format_vector_simple(self, vector: list[float]) -> str:
        """Simple vector formatting for SQL queries."""
        return ','.join(map(str, vector))

    def _safe_doc_id(self, doc_id: str) -> str:
        """Ensure doc_id is safe for SQL and doesn't contain special characters."""
        if not doc_id:
            return str(uuid.uuid4())
        # Remove or replace potentially problematic characters
        safe_id = str(doc_id)
        # Only allow alphanumeric, hyphens, underscores
        safe_id = ''.join(c for c in safe_id if c.isalnum() or c in '-_')
        if not safe_id:  # If all characters were removed
            return str(uuid.uuid4())
        return safe_id[:255]  # Limit length



class ClickzettaVectorFactory(AbstractVectorFactory):
    """Factory for creating Clickzetta vector instances."""

    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> BaseVector:
        """Initialize a Clickzetta vector instance."""
        # Get configuration from environment variables or dataset config
        config = ClickzettaConfig(
            username=dify_config.CLICKZETTA_USERNAME or "",
            password=dify_config.CLICKZETTA_PASSWORD or "",
            instance=dify_config.CLICKZETTA_INSTANCE or "",
            service=dify_config.CLICKZETTA_SERVICE or "api.clickzetta.com",
            workspace=dify_config.CLICKZETTA_WORKSPACE or "quick_start",
            vcluster=dify_config.CLICKZETTA_VCLUSTER or "default_ap",
            schema_name=dify_config.CLICKZETTA_SCHEMA or "dify",
            batch_size=dify_config.CLICKZETTA_BATCH_SIZE or 100,
            enable_inverted_index=dify_config.CLICKZETTA_ENABLE_INVERTED_INDEX or True,
            analyzer_type=dify_config.CLICKZETTA_ANALYZER_TYPE or "chinese",
            analyzer_mode=dify_config.CLICKZETTA_ANALYZER_MODE or "smart",
            vector_distance_function=dify_config.CLICKZETTA_VECTOR_DISTANCE_FUNCTION or "cosine_distance",
        )

        # Use dataset collection name as table name
        collection_name = Dataset.gen_collection_name_by_id(dataset.id).lower()

        return ClickzettaVector(collection_name=collection_name, config=config)

