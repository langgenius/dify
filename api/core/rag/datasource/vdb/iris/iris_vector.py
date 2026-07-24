"""InterSystems IRIS vector database implementation for Dify.

This module provides vector storage and retrieval using IRIS native VECTOR type
with HNSW indexing for efficient similarity search.
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from contextlib import contextmanager
from typing import TYPE_CHECKING, Any

from configs import dify_config
from configs.middleware.vdb.iris_config import IrisVectorConfig
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

if TYPE_CHECKING:
    import iris
else:
    try:
        import iris
    except ImportError:
        iris = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

# Singleton connection pool to minimize IRIS license usage
_pool_lock = threading.Lock()
_pool_instance: IrisConnectionPool | None = None


def get_iris_pool(config: IrisVectorConfig) -> IrisConnectionPool:
    """Get or create the global IRIS connection pool (singleton pattern)."""
    global _pool_instance  # pylint: disable=global-statement
    with _pool_lock:
        if _pool_instance is None:
            logger.info("Initializing IRIS connection pool")
            _pool_instance = IrisConnectionPool(config)
        return _pool_instance


class IrisConnectionPool:
    """Thread-safe connection pool for IRIS database."""

    def __init__(self, config: IrisVectorConfig) -> None:
        self.config = config
        self._pool: list[Any] = []
        self._lock = threading.Lock()
        self._min_size = config.IRIS_MIN_CONNECTION
        self._max_size = config.IRIS_MAX_CONNECTION
        self._in_use = 0
        self._schemas_initialized: set[str] = set()  # Cache for initialized schemas
        self._initialize_pool()

    def _initialize_pool(self) -> None:
        for _ in range(self._min_size):
            self._pool.append(self._create_connection())

    def _create_connection(self) -> Any:
        return iris.connect(
            hostname=self.config.IRIS_HOST,
            port=self.config.IRIS_SUPER_SERVER_PORT,
            namespace=self.config.IRIS_DATABASE,
            username=self.config.IRIS_USER,
            password=self.config.IRIS_PASSWORD,
        )

    def get_connection(self) -> Any:
        """Get a connection from pool or create new if available."""
        with self._lock:
            if self._pool:
                conn = self._pool.pop()
                self._in_use += 1
                return conn
            if self._in_use < self._max_size:
                conn = self._create_connection()
                self._in_use += 1
                return conn
            raise RuntimeError("Connection pool exhausted")

    def return_connection(self, conn: Any) -> None:
        """Return connection to pool after validating it."""
        if not conn:
            return

        # Validate connection health
        is_valid = False
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.close()
            is_valid = True
        except (OSError, RuntimeError) as e:
            logger.debug("Connection validation failed: %s", e)
            try:
                conn.close()
            except (OSError, RuntimeError):
                pass

        with self._lock:
            self._pool.append(conn if is_valid else self._create_connection())
            self._in_use -= 1

    def ensure_schema_exists(self, schema: str) -> None:
        """Ensure schema exists in IRIS database.

        This method is idempotent and thread-safe. It uses a memory cache to avoid
        redundant database queries for already-verified schemas.

        Args:
            schema: Schema name to ensure exists

        Raises:
            Exception: If schema creation fails
        """
        # Fast path: check cache first (no lock needed for read-only set lookup)
        if schema in self._schemas_initialized:
            return

        # Slow path: acquire lock and check again (double-checked locking)
        with self._lock:
            if schema in self._schemas_initialized:
                return

            # Get a connection to check/create schema
            conn = self._pool[0] if self._pool else self._create_connection()
            cursor = conn.cursor()
            try:
                # Check if schema exists using INFORMATION_SCHEMA
                check_sql = """
                    SELECT COUNT(*) FROM INFORMATION_SCHEMA.SCHEMATA
                    WHERE SCHEMA_NAME = ?
                """
                cursor.execute(check_sql, (schema,))  # Must be tuple or list
                exists = cursor.fetchone()[0] > 0

                if not exists:
                    # Schema doesn't exist, create it
                    cursor.execute(f"CREATE SCHEMA {schema}")
                    conn.commit()
                    logger.info("Created schema: %s", schema)
                else:
                    logger.debug("Schema already exists: %s", schema)

                # Add to cache to skip future checks
                self._schemas_initialized.add(schema)

            except Exception:
                conn.rollback()
                logger.exception("Failed to ensure schema %s exists", schema)
                raise
            finally:
                cursor.close()

    def close_all(self) -> None:
        """Close all connections (application shutdown only)."""
        with self._lock:
            for conn in self._pool:
                try:
                    conn.close()
                except (OSError, RuntimeError):
                    pass
            self._pool.clear()
            self._in_use = 0
            self._schemas_initialized.clear()


class IrisVector(BaseVector):
    """IRIS vector database implementation using native VECTOR type and HNSW indexing."""

    # Fallback score for full-text search when Rank function unavailable or TEXT_INDEX disabled
    _FULL_TEXT_FALLBACK_SCORE = 0.5

    def __init__(self, collection_name: str, config: IrisVectorConfig) -> None:
        super().__init__(collection_name)
        self.config = config
        self.table_name = f"embedding_{collection_name}".upper()
        self.schema = config.IRIS_SCHEMA or "dify"
        self.pool = get_iris_pool(config)

    def get_type(self) -> str:
        return VectorType.IRIS

    @contextmanager
    def _get_cursor(self):
        """Context manager for database cursor with connection pooling."""
        conn = self.pool.get_connection()
        cursor = conn.cursor()
        try:
            yield cursor
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            cursor.close()
            self.pool.return_connection(conn)

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs) -> list[str]:
        dimension = len(embeddings[0])
        self._create_collection(dimension)
        return self.add_texts(texts, embeddings)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **_kwargs) -> list[str]:
        """Add documents with embeddings to the collection."""
        added_ids = []
        with self._get_cursor() as cursor:
            for i, doc in enumerate(documents):
                doc_id = doc.metadata.get("doc_id", str(uuid.uuid4())) if doc.metadata else str(uuid.uuid4())
                metadata = json.dumps(doc.metadata) if doc.metadata else "{}"
                embedding_str = json.dumps(embeddings[i])

                sql = f"INSERT INTO {self.schema}.{self.table_name} (id, text, meta, embedding) VALUES (?, ?, ?, ?)"
                cursor.execute(sql, (doc_id, doc.page_content, metadata, embedding_str))
                added_ids.append(doc_id)

        return added_ids

    def text_exists(self, id: str) -> bool:  # pylint: disable=redefined-builtin
        try:
            with self._get_cursor() as cursor:
                sql = f"SELECT 1 FROM {self.schema}.{self.table_name} WHERE id = ?"
                cursor.execute(sql, (id,))
                return cursor.fetchone() is not None
        except (OSError, RuntimeError, ValueError):
            return False

    def delete_by_ids(self, ids: list[str]) -> None:
        if not ids:
            return

        with self._get_cursor() as cursor:
            placeholders = ",".join(["?" for _ in ids])
            sql = f"DELETE FROM {self.schema}.{self.table_name} WHERE id IN ({placeholders})"
            cursor.execute(sql, ids)

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        """Delete documents by metadata field (JSON LIKE pattern matching)."""
        with self._get_cursor() as cursor:
            pattern = f'%"{key}": "{value}"%'
            sql = f"DELETE FROM {self.schema}.{self.table_name} WHERE meta LIKE ?"
            cursor.execute(sql, (pattern,))

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        """Search similar documents using VECTOR_COSINE with HNSW index."""
        top_k = kwargs.get("top_k", 4)
        score_threshold = float(kwargs.get("score_threshold") or 0.0)
        embedding_str = json.dumps(query_vector)

        with self._get_cursor() as cursor:
            sql = f"""
                SELECT TOP {top_k} id, text, meta, VECTOR_COSINE(embedding, ?) as score
                FROM {self.schema}.{self.table_name}
                ORDER BY score DESC
            """
            cursor.execute(sql, (embedding_str,))

            docs = []
            for row in cursor.fetchall():
                if len(row) >= 4:
                    text, meta_str, score = row[1], row[2], float(row[3])
                    if score >= score_threshold:
                        metadata = json.loads(meta_str) if meta_str else {}
                        metadata["score"] = score
                        docs.append(Document(page_content=text, metadata=metadata))
            return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        """Search documents by full-text using iFind index with BM25 relevance scoring.

        When IRIS_TEXT_INDEX is enabled, this method uses the auto-generated Rank
        function from %iFind.Index.Basic to calculate BM25 relevance scores. The Rank
        function is automatically created with naming: {schema}.{table_name}_{index}Rank

        Args:
            query: Search query string
            **kwargs: Optional parameters including top_k, document_ids_filter

        Returns:
            List of Document objects with relevance scores in metadata["score"]
        """
        top_k = kwargs.get("top_k", 5)
        document_ids_filter = kwargs.get("document_ids_filter")

        with self._get_cursor() as cursor:
            if self.config.IRIS_TEXT_INDEX:
                # Use iFind full-text search with auto-generated Rank function
                text_index_name = f"idx_{self.table_name}_text"
                # IRIS removes underscores from function names
                table_no_underscore = self.table_name.replace("_", "")
                index_no_underscore = text_index_name.replace("_", "")
                rank_function = f"{self.schema}.{table_no_underscore}_{index_no_underscore}Rank"

                # Build WHERE clause with document ID filter if provided
                where_clause = f"WHERE %ID %FIND search_index({text_index_name}, ?)"
                # First param for Rank function, second for FIND
                params = [query, query]

                if document_ids_filter:
                    # Add document ID filter
                    placeholders = ",".join("?" * len(document_ids_filter))
                    where_clause += f" AND JSON_VALUE(meta, '$.document_id') IN ({placeholders})"
                    params.extend(document_ids_filter)

                sql = f"""
                    SELECT TOP {top_k}
                        id,
                        text,
                        meta,
                        {rank_function}(%ID, ?) AS score
                    FROM {self.schema}.{self.table_name}
                    {where_clause}
                    ORDER BY score DESC
                """

                logger.debug(
                    "iFind search: query='%s', index='%s', rank='%s'",
                    query,
                    text_index_name,
                    rank_function,
                )

                try:
                    cursor.execute(sql, params)
                except Exception:  # pylint: disable=broad-exception-caught
                    # Fallback to query without Rank function if it fails
                    logger.warning(
                        "Rank function '%s' failed, using fixed score",
                        rank_function,
                        exc_info=True,
                    )
                    sql_fallback = f"""
                        SELECT TOP {top_k} id, text, meta, {self._FULL_TEXT_FALLBACK_SCORE} AS score
                        FROM {self.schema}.{self.table_name}
                        {where_clause}
                    """
                    # Skip first param (for Rank function)
                    cursor.execute(sql_fallback, params[1:])
            else:
                # Fallback to LIKE search (IRIS_TEXT_INDEX disabled)
                from libs.helper import (  # pylint: disable=import-outside-toplevel
                    escape_like_pattern,
                )

                escaped_query = escape_like_pattern(query)
                query_pattern = f"%{escaped_query}%"

                # Build WHERE clause with document ID filter if provided
                where_clause = "WHERE text LIKE ? ESCAPE '\\\\'"
                params = [query_pattern]

                if document_ids_filter:
                    placeholders = ",".join("?" * len(document_ids_filter))
                    where_clause += f" AND JSON_VALUE(meta, '$.document_id') IN ({placeholders})"
                    params.extend(document_ids_filter)

                sql = f"""
                    SELECT TOP {top_k} id, text, meta, {self._FULL_TEXT_FALLBACK_SCORE} AS score
                    FROM {self.schema}.{self.table_name}
                    {where_clause}
                    ORDER BY LENGTH(text) ASC
                """

                logger.debug(
                    "LIKE fallback (TEXT_INDEX disabled): query='%s'",
                    query_pattern,
                )
                cursor.execute(sql, params)

            docs = []
            for row in cursor.fetchall():
                # Expecting 4 columns: id, text, meta, score
                if len(row) >= 4:
                    text_content = row[1]
                    meta_str = row[2]
                    score_value = row[3]

                    metadata = json.loads(meta_str) if meta_str else {}
                    # Add score to metadata for hybrid search compatibility
                    score = float(score_value) if score_value is not None else 0.0
                    metadata["score"] = score

                    docs.append(Document(page_content=text_content, metadata=metadata))

            logger.info(
                "Full-text search completed: query='%s', results=%d/%d",
                query,
                len(docs),
                top_k,
            )

            if not docs:
                logger.warning("Full-text search for '%s' returned no results", query)

            return docs

    def delete(self) -> None:
        """Delete the entire collection (drop table - permanent)."""
        with self._get_cursor() as cursor:
            sql = f"DROP TABLE {self.schema}.{self.table_name}"
            cursor.execute(sql)

    def _create_collection(self, dimension: int) -> None:
        """Create table with VECTOR column and HNSW index.

        Uses Redis lock to prevent concurrent creation attempts across multiple
        API server instances (api, worker, worker_beat).
        """
        cache_key = f"vector_indexing_{self._collection_name}"
        lock_name = f"{cache_key}_lock"

        with redis_client.lock(lock_name, timeout=20):  # pylint: disable=not-context-manager
            if redis_client.get(cache_key):
                return

            # Ensure schema exists (idempotent, cached after first call)
            self.pool.ensure_schema_exists(self.schema)

            with self._get_cursor() as cursor:
                # Create table with VECTOR column
                sql = f"""
                    CREATE TABLE {self.schema}.{self.table_name} (
                        id VARCHAR(255) PRIMARY KEY,
                        text CLOB,
                        meta CLOB,
                        embedding VECTOR(DOUBLE, {dimension})
                    )
                """
                logger.info("Creating table: %s.%s", self.schema, self.table_name)
                cursor.execute(sql)

                # Create HNSW index for vector similarity search
                index_name = f"idx_{self.table_name}_embedding"
                sql_index = (
                    f"CREATE INDEX {index_name} ON {self.schema}.{self.table_name} "
                    "(embedding) AS HNSW(Distance='Cosine')"
                )
                logger.info("Creating HNSW index: %s", index_name)
                cursor.execute(sql_index)
                logger.info("HNSW index created successfully: %s", index_name)

                # Create full-text search index if enabled
                logger.info(
                    "IRIS_TEXT_INDEX config value: %s (type: %s)",
                    self.config.IRIS_TEXT_INDEX,
                    type(self.config.IRIS_TEXT_INDEX),
                )
                if self.config.IRIS_TEXT_INDEX:
                    text_index_name = f"idx_{self.table_name}_text"
                    language = self.config.IRIS_TEXT_INDEX_LANGUAGE
                    # Fixed: Removed extra parentheses and corrected syntax
                    sql_text_index = f"""
                        CREATE INDEX {text_index_name} ON {self.schema}.{self.table_name} (text)
                        AS %iFind.Index.Basic
                        (LANGUAGE = '{language}', LOWER = 1, INDEXOPTION = 0)
                    """
                    logger.info(
                        "Creating text index: %s with language: %s",
                        text_index_name,
                        language,
                    )
                    logger.info("SQL for text index: %s", sql_text_index)
                    cursor.execute(sql_text_index)
                    logger.info("Text index created successfully: %s", text_index_name)
                else:
                    logger.warning("Text index creation skipped - IRIS_TEXT_INDEX is disabled")

            redis_client.set(cache_key, 1, ex=3600)


class IrisVectorFactory(AbstractVectorFactory):
    """Factory for creating IrisVector instances."""

    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> IrisVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            index_struct_dict = self.gen_index_struct_dict(VectorType.IRIS, collection_name)
            dataset.index_struct = json.dumps(index_struct_dict)

        return IrisVector(
            collection_name=collection_name,
            config=IrisVectorConfig(
                IRIS_HOST=dify_config.IRIS_HOST,
                IRIS_SUPER_SERVER_PORT=dify_config.IRIS_SUPER_SERVER_PORT,
                IRIS_USER=dify_config.IRIS_USER,
                IRIS_PASSWORD=dify_config.IRIS_PASSWORD,
                IRIS_DATABASE=dify_config.IRIS_DATABASE,
                IRIS_SCHEMA=dify_config.IRIS_SCHEMA,
                IRIS_CONNECTION_URL=dify_config.IRIS_CONNECTION_URL,
                IRIS_MIN_CONNECTION=dify_config.IRIS_MIN_CONNECTION,
                IRIS_MAX_CONNECTION=dify_config.IRIS_MAX_CONNECTION,
                IRIS_TEXT_INDEX=dify_config.IRIS_TEXT_INDEX,
                IRIS_TEXT_INDEX_LANGUAGE=dify_config.IRIS_TEXT_INDEX_LANGUAGE,
            ),
        )
