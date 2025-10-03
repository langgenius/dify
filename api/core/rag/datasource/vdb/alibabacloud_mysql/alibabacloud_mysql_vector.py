import hashlib
import json
import logging
import uuid
from contextlib import contextmanager
from typing import Any, Literal, cast

import mysql.connector
from mysql.connector import Error as MySQLError
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


class AlibabaCloudMySQLVectorConfig(BaseModel):
    host: str
    port: int
    user: str
    password: str
    database: str
    max_connection: int
    charset: str = "utf8mb4"
    distance_function: Literal["cosine", "euclidean"] = "cosine"
    hnsw_m: int = 6

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict):
        if not values.get("host"):
            raise ValueError("config ALIBABACLOUD_MYSQL_HOST is required")
        if not values.get("port"):
            raise ValueError("config ALIBABACLOUD_MYSQL_PORT is required")
        if not values.get("user"):
            raise ValueError("config ALIBABACLOUD_MYSQL_USER is required")
        if values.get("password") is None:
            raise ValueError("config ALIBABACLOUD_MYSQL_PASSWORD is required")
        if not values.get("database"):
            raise ValueError("config ALIBABACLOUD_MYSQL_DATABASE is required")
        if not values.get("max_connection"):
            raise ValueError("config ALIBABACLOUD_MYSQL_MAX_CONNECTION is required")
        return values


SQL_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS {table_name} (
    id VARCHAR(36) PRIMARY KEY,
    text LONGTEXT NOT NULL,
    meta JSON NOT NULL,
    embedding VECTOR({dimension}) NOT NULL,
    VECTOR INDEX (embedding) M={hnsw_m} DISTANCE={distance_function}
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

SQL_CREATE_META_INDEX = """
CREATE INDEX idx_{index_hash}_meta ON {table_name}
    ((CAST(JSON_UNQUOTE(JSON_EXTRACT(meta, '$.document_id')) AS CHAR(36))));
"""

SQL_CREATE_FULLTEXT_INDEX = """
CREATE FULLTEXT INDEX idx_{index_hash}_text ON {table_name} (text) WITH PARSER ngram;
"""


class AlibabaCloudMySQLVector(BaseVector):
    def __init__(self, collection_name: str, config: AlibabaCloudMySQLVectorConfig):
        super().__init__(collection_name)
        self.pool = self._create_connection_pool(config)
        self.table_name = collection_name.lower()
        self.index_hash = hashlib.md5(self.table_name.encode()).hexdigest()[:8]
        self.distance_function = config.distance_function.lower()
        self.hnsw_m = config.hnsw_m
        self._check_vector_support()

    def get_type(self) -> str:
        return VectorType.ALIBABACLOUD_MYSQL

    def _create_connection_pool(self, config: AlibabaCloudMySQLVectorConfig):
        # Create connection pool using mysql-connector-python pooling
        pool_config: dict[str, Any] = {
            "host": config.host,
            "port": config.port,
            "user": config.user,
            "password": config.password,
            "database": config.database,
            "charset": config.charset,
            "autocommit": True,
            "pool_name": f"pool_{self.collection_name}",
            "pool_size": config.max_connection,
            "pool_reset_session": True,
        }
        return mysql.connector.pooling.MySQLConnectionPool(**pool_config)

    def _check_vector_support(self):
        """Check if the MySQL server supports vector operations."""
        try:
            with self._get_cursor() as cur:
                # Check MySQL version and vector support
                cur.execute("SELECT VERSION()")
                version = cur.fetchone()["VERSION()"]
                logger.debug("Connected to MySQL version: %s", version)
                # Try to execute a simple vector function to verify support
                cur.execute("SELECT VEC_FromText('[1,2,3]') IS NOT NULL as vector_support")
                result = cur.fetchone()
                if not result or not result.get("vector_support"):
                    raise ValueError(
                        "RDS MySQL Vector functions are not available."
                        " Please ensure you're using RDS MySQL 8.0.36+ with Vector support."
                    )

        except MySQLError as e:
            if "FUNCTION" in str(e) and "VEC_FromText" in str(e):
                raise ValueError(
                    "RDS MySQL Vector functions are not available."
                    " Please ensure you're using RDS MySQL 8.0.36+ with Vector support."
                ) from e
            raise e

    @contextmanager
    def _get_cursor(self):
        conn = self.pool.get_connection()
        cur = conn.cursor(dictionary=True)
        try:
            yield cur
        finally:
            cur.close()
            conn.close()

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        dimension = len(embeddings[0])
        self._create_collection(dimension)
        return self.add_texts(texts, embeddings)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        values = []
        pks = []
        for i, doc in enumerate(documents):
            if doc.metadata is not None:
                doc_id = doc.metadata.get("doc_id", str(uuid.uuid4()))
                pks.append(doc_id)
                # Convert embedding list to Aliyun MySQL vector format
                vector_str = "[" + ",".join(map(str, embeddings[i])) + "]"
                values.append(
                    (
                        doc_id,
                        doc.page_content,
                        json.dumps(doc.metadata),
                        vector_str,
                    )
                )

        with self._get_cursor() as cur:
            insert_sql = (
                f"INSERT INTO {self.table_name} (id, text, meta, embedding) VALUES (%s, %s, %s, VEC_FromText(%s))"
            )
            cur.executemany(insert_sql, values)
        return pks

    def text_exists(self, id: str) -> bool:
        with self._get_cursor() as cur:
            cur.execute(f"SELECT id FROM {self.table_name} WHERE id = %s", (id,))
            return cur.fetchone() is not None

    def get_by_ids(self, ids: list[str]) -> list[Document]:
        if not ids:
            return []

        with self._get_cursor() as cur:
            placeholders = ",".join(["%s"] * len(ids))
            cur.execute(f"SELECT meta, text FROM {self.table_name} WHERE id IN ({placeholders})", ids)
            docs = []
            for record in cur:
                metadata = record["meta"]
                if isinstance(metadata, str):
                    metadata = json.loads(metadata)
                docs.append(Document(page_content=record["text"], metadata=metadata))
        return docs

    def delete_by_ids(self, ids: list[str]):
        # Avoiding crashes caused by performing delete operations on empty lists
        if not ids:
            return

        with self._get_cursor() as cur:
            try:
                placeholders = ",".join(["%s"] * len(ids))
                cur.execute(f"DELETE FROM {self.table_name} WHERE id IN ({placeholders})", ids)
            except MySQLError as e:
                if e.errno == 1146:  # Table doesn't exist
                    logger.warning("Table %s not found, skipping delete operation.", self.table_name)
                    return
                else:
                    raise e

    def delete_by_metadata_field(self, key: str, value: str):
        with self._get_cursor() as cur:
            cur.execute(
                f"DELETE FROM {self.table_name} WHERE JSON_UNQUOTE(JSON_EXTRACT(meta, %s)) = %s", (f"$.{key}", value)
            )

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        """
        Search the nearest neighbors to a vector using RDS MySQL vector distance functions.

        :param query_vector: The input vector to search for similar items.
        :return: List of Documents that are nearest to the query vector.
        """
        top_k = kwargs.get("top_k", 4)
        if not isinstance(top_k, int) or top_k <= 0:
            raise ValueError("top_k must be a positive integer")

        document_ids_filter = kwargs.get("document_ids_filter")
        where_clause = ""
        params = []

        if document_ids_filter:
            placeholders = ",".join(["%s"] * len(document_ids_filter))
            where_clause = f" WHERE JSON_UNQUOTE(JSON_EXTRACT(meta, '$.document_id')) IN ({placeholders}) "
            params.extend(document_ids_filter)

        # Convert query vector to RDS MySQL vector format
        query_vector_str = "[" + ",".join(map(str, query_vector)) + "]"

        # Use RSD MySQL's native vector distance functions
        with self._get_cursor() as cur:
            # Choose distance function based on configuration
            distance_func = "VEC_DISTANCE_COSINE" if self.distance_function == "cosine" else "VEC_DISTANCE_EUCLIDEAN"

            # Note: RDS MySQL optimizer will use vector index when ORDER BY + LIMIT are present
            # Use column alias in ORDER BY to avoid calculating distance twice
            sql = f"""
            SELECT meta, text,
                   {distance_func}(embedding, VEC_FromText(%s)) AS distance
            FROM {self.table_name}
            {where_clause}
            ORDER BY distance
            LIMIT %s
            """
            query_params = [query_vector_str] + params + [top_k]

            cur.execute(sql, query_params)

            docs = []
            score_threshold = float(kwargs.get("score_threshold") or 0.0)

            for record in cur:
                try:
                    distance = float(record["distance"])
                    # Convert distance to similarity score
                    if self.distance_function == "cosine":
                        # For cosine distance: similarity = 1 - distance
                        similarity = 1.0 - distance
                    else:
                        # For euclidean distance: use inverse relationship
                        # similarity = 1 / (1 + distance)
                        similarity = 1.0 / (1.0 + distance)

                    metadata = record["meta"]
                    if isinstance(metadata, str):
                        metadata = json.loads(metadata)
                    metadata["score"] = similarity
                    metadata["distance"] = distance

                    if similarity >= score_threshold:
                        docs.append(Document(page_content=record["text"], metadata=metadata))
                except (ValueError, json.JSONDecodeError) as e:
                    logger.warning("Error processing search result: %s", e)
                    continue

            return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 5)
        if not isinstance(top_k, int) or top_k <= 0:
            raise ValueError("top_k must be a positive integer")

        document_ids_filter = kwargs.get("document_ids_filter")
        where_clause = ""
        params = []

        if document_ids_filter:
            placeholders = ",".join(["%s"] * len(document_ids_filter))
            where_clause = f" AND JSON_UNQUOTE(JSON_EXTRACT(meta, '$.document_id')) IN ({placeholders}) "
            params.extend(document_ids_filter)

        with self._get_cursor() as cur:
            # Build query parameters: query (twice for MATCH clauses), document_ids_filter (if any), top_k
            query_params = [query, query] + params + [top_k]
            cur.execute(
                f"""SELECT meta, text,
                    MATCH(text) AGAINST(%s IN NATURAL LANGUAGE MODE) AS score
                    FROM {self.table_name}
                    WHERE MATCH(text) AGAINST(%s IN NATURAL LANGUAGE MODE)
                    {where_clause}
                    ORDER BY score DESC
                    LIMIT %s""",
                query_params,
            )
            docs = []
            for record in cur:
                metadata = record["meta"]
                if isinstance(metadata, str):
                    metadata = json.loads(metadata)
                metadata["score"] = float(record["score"])
                docs.append(Document(page_content=record["text"], metadata=metadata))
        return docs

    def delete(self):
        with self._get_cursor() as cur:
            cur.execute(f"DROP TABLE IF EXISTS {self.table_name}")

    def _create_collection(self, dimension: int):
        collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
        lock_name = f"{collection_exist_cache_key}_lock"
        with redis_client.lock(lock_name, timeout=20):
            if redis_client.get(collection_exist_cache_key):
                return

            with self._get_cursor() as cur:
                # Create table with vector column and vector index
                cur.execute(
                    SQL_CREATE_TABLE.format(
                        table_name=self.table_name,
                        dimension=dimension,
                        distance_function=self.distance_function,
                        hnsw_m=self.hnsw_m,
                    )
                )
                # Create metadata index (check if exists first)
                try:
                    cur.execute(SQL_CREATE_META_INDEX.format(table_name=self.table_name, index_hash=self.index_hash))
                except MySQLError as e:
                    if e.errno != 1061:  # Duplicate key name
                        logger.warning("Could not create meta index: %s", e)

                # Create full-text index for text search
                try:
                    cur.execute(
                        SQL_CREATE_FULLTEXT_INDEX.format(table_name=self.table_name, index_hash=self.index_hash)
                    )
                except MySQLError as e:
                    if e.errno != 1061:  # Duplicate key name
                        logger.warning("Could not create fulltext index: %s", e)

            redis_client.set(collection_exist_cache_key, 1, ex=3600)


class AlibabaCloudMySQLVectorFactory(AbstractVectorFactory):
    def _validate_distance_function(self, distance_function: str) -> Literal["cosine", "euclidean"]:
        """Validate and return the distance function as a proper Literal type."""
        if distance_function not in ["cosine", "euclidean"]:
            raise ValueError(f"Invalid distance function: {distance_function}. Must be 'cosine' or 'euclidean'")
        return cast(Literal["cosine", "euclidean"], distance_function)

    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> AlibabaCloudMySQLVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(
                self.gen_index_struct_dict(VectorType.ALIBABACLOUD_MYSQL, collection_name)
            )
        return AlibabaCloudMySQLVector(
            collection_name=collection_name,
            config=AlibabaCloudMySQLVectorConfig(
                host=dify_config.ALIBABACLOUD_MYSQL_HOST or "localhost",
                port=dify_config.ALIBABACLOUD_MYSQL_PORT,
                user=dify_config.ALIBABACLOUD_MYSQL_USER or "root",
                password=dify_config.ALIBABACLOUD_MYSQL_PASSWORD or "",
                database=dify_config.ALIBABACLOUD_MYSQL_DATABASE or "dify",
                max_connection=dify_config.ALIBABACLOUD_MYSQL_MAX_CONNECTION,
                charset=dify_config.ALIBABACLOUD_MYSQL_CHARSET or "utf8mb4",
                distance_function=self._validate_distance_function(
                    dify_config.ALIBABACLOUD_MYSQL_DISTANCE_FUNCTION or "cosine"
                ),
                hnsw_m=dify_config.ALIBABACLOUD_MYSQL_HNSW_M or 6,
            ),
        )
