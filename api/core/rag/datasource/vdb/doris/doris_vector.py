"""
Apache Doris vector database implementation for Dify's RAG system.

This module provides integration with Apache Doris vector database for storing and retrieving
document embeddings used in retrieval-augmented generation workflows.

Apache Doris supports both vector search and full-text search with BM25 scoring,
enabling hybrid search capabilities.
"""

import base64
import hashlib
import json
import logging
import time
import uuid
from contextlib import contextmanager
from typing import Any
from urllib.parse import quote, urljoin

import httpx
from mysql.connector import pooling
from pydantic import BaseModel, model_validator

from configs import dify_config
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)


VALID_TEXT_ANALYZERS = {"english", "chinese", "standard", "unicode", "default"}


class DorisConfig(BaseModel):
    """Configuration model for Apache Doris connection settings."""

    host: str
    port: int
    user: str
    password: str
    database: str
    max_connection: int
    enable_text_search: bool = True
    text_search_analyzer: str = "english"
    streamload_port: int = 8030
    streamload_scheme: str = "http"
    streamload_max_filter_ratio: float = 0.1
    table_replication_num: int = 1
    table_buckets: int = 10

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict) -> dict:
        """Validates that required configuration values are present."""
        if not values.get("host"):
            raise ValueError("config DORIS_HOST is required")
        if not values.get("user"):
            raise ValueError("config DORIS_USER is required")
        if not values.get("password"):
            raise ValueError("config DORIS_PASSWORD is required")
        if not values.get("database"):
            raise ValueError("config DORIS_DATABASE is required")
        # Validate text search analyzer
        analyzer = values.get("text_search_analyzer", "english")
        if analyzer and analyzer not in VALID_TEXT_ANALYZERS:
            raise ValueError(f"config DORIS_TEXT_SEARCH_ANALYZER must be one of {VALID_TEXT_ANALYZERS}")
        # Validate streamload scheme
        scheme = values.get("streamload_scheme", "http")
        if scheme not in ("http", "https"):
            raise ValueError("config DORIS_STREAMLOAD_SCHEME must be 'http' or 'https'")
        return values


class DorisConnectionPool:
    """Thread-safe connection pool for Apache Doris database."""

    def __init__(self, config: DorisConfig) -> None:
        self.config = config
        self._pool_config: dict[str, Any] = {
            "pool_name": "doris_pool",
            "pool_size": config.max_connection,
            "pool_reset_session": True,
            "host": config.host,
            "port": config.port,
            "user": config.user,
            "password": config.password,
            "database": config.database,
            "charset": "utf8mb4",
            "autocommit": False,
        }
        self._pool = pooling.MySQLConnectionPool(**self._pool_config)

    def get_connection(self) -> Any:
        """Get a connection from pool."""
        return self._pool.get_connection()


class DorisVector(BaseVector):
    """
    Apache Doris vector database implementation for document storage and retrieval.

    Handles creation, insertion, deletion, and querying of document embeddings
    in Apache Doris tables with support for both vector similarity search and
    full-text search with BM25 scoring.
    """

    def __init__(self, collection_name: str, config: DorisConfig, attributes: list):
        """
        Initializes the Apache Doris vector store.

        Args:
            collection_name: Name of the Doris table/collection
            config: Doris configuration settings
            attributes: List of metadata attributes to store
        """
        super().__init__(collection_name)
        self._pool = DorisConnectionPool(config)
        self._attributes = attributes
        self._config = config
        # Table name format: embedding_ + collection_name
        # collection_name already includes Vector_index_ prefix and _Node suffix from Dataset.gen_collection_name_by_id
        self.table_name = f"embedding_{collection_name}"
        self.index_hash = hashlib.md5(self.table_name.encode()).hexdigest()[:8]

    def get_type(self) -> str:
        """Returns the vector database type identifier."""
        return VectorType.DORIS

    @contextmanager
    def _get_cursor(self):
        """Context manager for database cursor."""
        conn = self._pool.get_connection()
        cur = conn.cursor(dictionary=True)
        try:
            # Ensure database is selected (pool connections may lose context)
            cur.execute(f"USE `{self._config.database}`")
            yield cur
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            cur.close()
            conn.close()

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        """
        Creates a new table and adds initial documents with embeddings.

        Args:
            texts: List of Document objects to insert
            embeddings: List of embedding vectors
            **kwargs: Additional arguments
        """
        dimension = len(embeddings[0]) if embeddings else 0
        self._create_collection(dimension)
        return self.add_texts(texts, embeddings)

    def _wait_for_table_normal_state(self, cursor, max_wait_seconds: int = 60) -> bool:
        """
        Wait for the table to return to NORMAL state after schema changes.

        Args:
            cursor: Database cursor
            max_wait_seconds: Maximum time to wait in seconds

        Returns:
            True if table is in NORMAL state, False if timeout
        """
        start_time = time.time()
        while time.time() - start_time < max_wait_seconds:
            try:
                cursor.execute(
                    f"SHOW ALTER TABLE COLUMN FROM `{self._config.database}` "
                    f"WHERE TableName = '{self.table_name}' ORDER BY CreateTime DESC LIMIT 1"
                )
                result = cursor.fetchone()
                if result is None:
                    # No schema change in progress
                    return True
                # Check if state is FINISHED or CANCELLED
                state = result.get("State", "") if isinstance(result, dict) else ""
                if state in ("FINISHED", "CANCELLED", ""):
                    return True
            except Exception:
                # If query fails, assume table is ready
                return True
            time.sleep(1)
        return False

    def _create_collection(self, dimension: int):
        """
        Creates the Doris table with required schema if it doesn't exist.

        Uses Redis locking to prevent concurrent creation attempts.
        """
        lock_name = f"vector_indexing_lock_{self._collection_name}"
        with redis_client.lock(lock_name, timeout=120):
            cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(cache_key):
                return

            try:
                with self._get_cursor() as cur:
                    # Create table with vector column and text column
                    # Doris uses ARRAY<FLOAT> for vector type
                    # Use backticks for table name quoting (MySQL/Doris standard)
                    create_table_sql = f"""
                    CREATE TABLE IF NOT EXISTS `{self.table_name}` (
                        id VARCHAR(255) NOT NULL,
                        text TEXT NOT NULL,
                        meta JSON NOT NULL,
                        embedding ARRAY<FLOAT> NOT NULL
                    ) ENGINE=OLAP
                    DUPLICATE KEY(id)
                    DISTRIBUTED BY HASH(id) BUCKETS {self._config.table_buckets}
                    PROPERTIES (
                        "replication_num" = "{self._config.table_replication_num}"
                    )
                    """
                    cur.execute(create_table_sql)

                    # Create vector index using ANN (Approximate Nearest Neighbor)
                    # Using HNSW algorithm with L2 distance for efficient similarity search
                    create_vector_index_sql = f"""
                    CREATE INDEX IF NOT EXISTS idx_embedding_{self.index_hash}
                    ON `{self.table_name}`(embedding)
                    USING ANN
                    PROPERTIES(
                        "index_type" = "hnsw",
                        "metric_type" = "l2_distance",
                        "dim" = "{dimension}"
                    )
                    """
                    cur.execute(create_vector_index_sql)

                    # Create inverted index for full-text search if enabled
                    if self._config.enable_text_search:
                        # Wait for vector index creation to complete before creating text index
                        self._wait_for_table_normal_state(cur, max_wait_seconds=60)
                        try:
                            analyzer = self._config.text_search_analyzer or "english"
                            create_text_index_sql = f"""
                            CREATE INDEX IF NOT EXISTS idx_text_{self.index_hash}
                            ON `{self.table_name}`(text)
                            USING INVERTED
                            PROPERTIES (
                                "parser" = "{analyzer}",
                                "support_phrase" = "true"
                            )
                            """
                            cur.execute(create_text_index_sql)
                        except Exception as e:
                            logger.warning("Could not create text search index: %s", e)

                redis_client.set(cache_key, 1, ex=3600)
            except Exception:
                logger.exception("Error creating table %s", self.table_name)
                raise

    def _streamload(self, data: list[dict]) -> None:
        """
        Load data into Doris using StreamLoad HTTP API.

        Args:
            data: List of dictionaries containing row data

        Raises:
            Exception: If StreamLoad fails
        """
        if not data:
            return

        # Format data as JSON array for StreamLoad
        # With strip_outer_array=true, Doris will parse each element in the array as a row
        json_data = json.dumps(data)

        # StreamLoad endpoint URL with URL encoding for database and table names
        encoded_database = quote(self._config.database, safe="")
        encoded_table = quote(self.table_name, safe="")
        url = f"{self._config.streamload_scheme}://{self._config.host}:{self._config.streamload_port}/api/{encoded_database}/{encoded_table}/_stream_load"

        # StreamLoad parameters
        # Format parameters are now in headers, only keep load_mem_limit in params
        params = {
            "load_mem_limit": "2147483648",  # 2GB
        }

        # Headers for authentication and StreamLoad configuration
        # Doris StreamLoad uses Basic Auth with base64 encoding
        auth_string = f"{self._config.user}:{self._config.password}"
        auth_bytes = auth_string.encode("utf-8")
        auth_b64 = base64.b64encode(auth_bytes).decode("utf-8")

        headers = {
            "Authorization": f"Basic {auth_b64}",
            "Content-Type": "application/json",
            "Expect": "100-continue",
            "format": "json",  # Specify format in header
            "strip_outer_array": "true",  # Parse each array element as a row
            "strict_mode": "false",  # Disable strict mode to allow data type conversion
            "max_filter_ratio": str(self._config.streamload_max_filter_ratio),
            "fuzzy_parse": "true",  # Enable fuzzy parsing for better compatibility
            "jsonpaths": '["$.id", "$.text", "$.meta", "$.embedding"]',  # Explicit column mapping
            "columns": "id,text,meta,embedding",  # Column order in table
        }

        try:
            # Manually handle redirects to ensure Authorization header is preserved
            max_redirects = 5
            redirect_count = 0
            current_url = url
            response = None

            # Disable auto-follow to manually handle redirects
            with httpx.Client(timeout=300.0, follow_redirects=False) as client:
                while redirect_count < max_redirects:
                    # For redirects, check if URL already contains query params
                    # If redirect URL contains params, don't add them again
                    if redirect_count == 0 or "?" not in current_url:
                        request_params = params
                    else:
                        request_params = None  # Redirect URL already has params

                    response = client.put(
                        current_url,
                        content=json_data.encode("utf-8"),
                        params=request_params,
                        headers=headers,
                    )

                    # Handle redirect
                    if response.status_code in (301, 302, 303, 307, 308):
                        redirect_count += 1
                        location = response.headers.get("Location")
                        if not location:
                            raise Exception("Redirect response missing Location header")

                        # Parse redirect URL
                        if location.startswith("http://") or location.startswith("https://"):
                            current_url = location
                        else:
                            # Relative redirect
                            current_url = urljoin(current_url, location)

                        logger.info("Following redirect %s to %s", redirect_count, current_url)
                        continue

                    # Not a redirect, break the loop
                    break

                if response is None:
                    raise Exception("No response received after redirects")

                response.raise_for_status()
                result = response.json()

                # Check StreamLoad status
                if result.get("Status") != "Success":
                    error_msg = result.get("Message", "Unknown error")
                    error_url = result.get("ErrorURL", "")
                    # Log full response for debugging
                    logger.error("StreamLoad failed. Full response: %s", json.dumps(result, indent=2))
                    raise Exception(f"StreamLoad failed: {error_msg}. ErrorURL: {error_url}")

                # Log success with details
                loaded_rows = result.get("NumberLoadedRows", 0)
                filtered_rows = result.get("NumberFilteredRows", 0)
                total_rows = result.get("NumberTotalRows", len(data))
                logger.info(
                    "StreamLoad completed: %s/%s rows loaded, %s rows filtered",
                    loaded_rows,
                    total_rows,
                    filtered_rows,
                )

                # Warn if any rows were filtered
                if filtered_rows > 0:
                    logger.warning(
                        "StreamLoad filtered %s rows. Check ErrorURL if available: %s",
                        filtered_rows,
                        result.get("ErrorURL", "N/A"),
                    )

        except httpx.HTTPError as e:
            logger.exception("StreamLoad HTTP request failed")
            raise Exception(f"StreamLoad request failed: {str(e)}") from e
        except Exception:
            logger.exception("StreamLoad failed")
            raise

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        """
        Adds documents with their embeddings to the table using StreamLoad.

        Args:
            documents: List of Document objects
            embeddings: List of embedding vectors
            **kwargs: Additional arguments

        Returns:
            List of inserted document IDs
        """
        if not documents or not embeddings:
            return []

        pks = []
        streamload_data = []
        for i, doc in enumerate(documents):
            if doc.metadata is not None:
                doc_id = doc.metadata.get("doc_id", str(uuid.uuid4()))
                pks.append(doc_id)

                # Format data for StreamLoad JSON format
                # Embedding needs to be formatted as array of floats for Doris ARRAY<FLOAT>
                embedding_array = [float(x) for x in embeddings[i]]

                # Ensure meta is a dict (Doris JSON type accepts dict)
                meta_dict = doc.metadata if isinstance(doc.metadata, dict) else {}

                row_data = {
                    "id": str(doc_id),
                    "text": str(doc.page_content) if doc.page_content else "",
                    "meta": meta_dict,  # Doris JSON type accepts dict directly
                    "embedding": embedding_array,
                }
                streamload_data.append(row_data)

        if streamload_data:
            self._streamload(streamload_data)

        return pks

    def text_exists(self, id: str) -> bool:
        """Checks if a document with the given doc_id exists in the table."""
        with self._get_cursor() as cur:
            cur.execute(f"SELECT id FROM `{self.table_name}` WHERE id = %s", (id,))
            return cur.fetchone() is not None

    def delete_by_ids(self, ids: list[str]) -> None:
        """
        Deletes objects by their ID identifiers.

        Args:
            ids: List of document IDs to delete
        """
        if not ids:
            return

        with self._get_cursor() as cur:
            try:
                placeholders = ",".join(["%s"] * len(ids))
                cur.execute(f"DELETE FROM `{self.table_name}` WHERE id IN ({placeholders})", ids)
            except Exception as e:
                logger.warning("Error deleting documents: %s", e)
                raise

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        """
        Deletes all objects matching a specific metadata field value.

        Args:
            key: Metadata field key
            value: Metadata field value
        """
        with self._get_cursor() as cur:
            try:
                # Use JSON_EXTRACT for JSON field access
                cur.execute(
                    f"DELETE FROM `{self.table_name}` WHERE JSON_EXTRACT(meta, %s) = %s",
                    (f"$.{key}", value),
                )
            except Exception as e:
                logger.warning("Error deleting by metadata field: %s", e)
                raise

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        """
        Performs vector similarity search using the provided query vector.

        Args:
            query_vector: Query embedding vector
            **kwargs: Additional search parameters (top_k, score_threshold, document_ids_filter)

        Returns:
            List of Document objects sorted by relevance score
        """
        top_k = int(kwargs.get("top_k", 4))
        score_threshold = float(kwargs.get("score_threshold") or 0.0)
        document_ids_filter = kwargs.get("document_ids_filter") or []

        # Build WHERE clause for document filtering
        where_clause = ""
        params: list[Any] = []
        if document_ids_filter:
            placeholders = ",".join(["%s"] * len(document_ids_filter))
            where_clause = f"WHERE JSON_EXTRACT(meta, '$.document_id') IN ({placeholders})"
            params.extend(document_ids_filter)

        # Convert query vector to string format for Doris ARRAY
        query_vector_str = "[" + ",".join(str(float(x)) for x in query_vector) + "]"

        with self._get_cursor() as cur:
            # Use cosine_distance for similarity search
            # Doris supports cosine_distance function for vector similarity
            search_sql = f"""
            SELECT meta, text,
                   cosine_distance(embedding, CAST(%s AS ARRAY<FLOAT>)) AS distance
            FROM `{self.table_name}`
            {where_clause}
            ORDER BY distance ASC
            LIMIT %s
            """
            params.insert(0, query_vector_str)
            params.append(top_k)

            cur.execute(search_sql, params)
            docs = []
            for row in cur.fetchall():
                metadata = json.loads(row["meta"]) if isinstance(row["meta"], str) else row["meta"]
                text = row["text"]
                distance = float(row["distance"])

                # Convert distance to similarity score (1 - distance for cosine)
                score = 1.0 - distance

                if score >= score_threshold:
                    metadata["score"] = score
                    docs.append(Document(page_content=text, metadata=metadata))

            # Sort by score descending
            docs.sort(key=lambda d: d.metadata.get("score", 0.0), reverse=True)
            return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        """
        Performs BM25 full-text search on document content.

        Args:
            query: Search query string
            **kwargs: Additional search parameters (top_k, document_ids_filter)

        Returns:
            List of Document objects with relevance scores
        """
        top_k = int(kwargs.get("top_k", 4))
        document_ids_filter = kwargs.get("document_ids_filter") or []

        # Build WHERE clause
        where_parts: list[str] = []
        params: list[Any] = []

        # Text search condition using MATCH_ANY for keyword search
        where_parts.append("text MATCH_ANY %s")
        params.append(query)

        # Document ID filtering
        if document_ids_filter:
            placeholders = ",".join(["%s"] * len(document_ids_filter))
            where_parts.append(f"JSON_EXTRACT(meta, '$.document_id') IN ({placeholders})")
            params.extend(document_ids_filter)

        where_clause = "WHERE " + " AND ".join(where_parts)

        with self._get_cursor() as cur:
            # Use BM25 scoring with score() function
            search_sql = f"""
            SELECT meta, text, score() AS relevance
            FROM `{self.table_name}`
            {where_clause}
            ORDER BY relevance DESC
            LIMIT %s
            """
            params.append(top_k)

            cur.execute(search_sql, params)
            docs = []
            for row in cur.fetchall():
                metadata = json.loads(row["meta"]) if isinstance(row["meta"], str) else row["meta"]
                text = row["text"]
                score = float(row["relevance"])

                metadata["score"] = score
                docs.append(Document(page_content=text, metadata=metadata))

            return docs

    def delete(self):
        """Deletes the entire table from Doris."""
        with self._get_cursor() as cur:
            cur.execute(f"DROP TABLE IF EXISTS `{self.table_name}`")


class DorisVectorFactory(AbstractVectorFactory):
    """Factory class for creating DorisVector instances."""

    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> DorisVector:
        """
        Initializes a DorisVector instance for the given dataset.

        Uses existing collection name from dataset index structure or generates a new one.
        Updates dataset index structure if not already set.
        """
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.DORIS, collection_name))

        return DorisVector(
            collection_name=collection_name,
            config=DorisConfig(
                host=dify_config.DORIS_HOST or "",
                port=dify_config.DORIS_PORT,
                user=dify_config.DORIS_USER or "",
                password=dify_config.DORIS_PASSWORD or "",
                database=dify_config.DORIS_DATABASE or "",
                max_connection=dify_config.DORIS_MAX_CONNECTION,
                enable_text_search=dify_config.DORIS_ENABLE_TEXT_SEARCH,
                text_search_analyzer=dify_config.DORIS_TEXT_SEARCH_ANALYZER or "english",
                streamload_port=dify_config.DORIS_STREAMLOAD_PORT,
                streamload_scheme=dify_config.DORIS_STREAMLOAD_SCHEME,
                streamload_max_filter_ratio=dify_config.DORIS_STREAMLOAD_MAX_FILTER_RATIO,
                table_replication_num=dify_config.DORIS_TABLE_REPLICATION_NUM,
                table_buckets=dify_config.DORIS_TABLE_BUCKETS,
            ),
            attributes=attributes,
        )
