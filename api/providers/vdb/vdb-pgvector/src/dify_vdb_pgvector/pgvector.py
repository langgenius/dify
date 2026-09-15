import hashlib
import json
import logging
import uuid
from contextlib import contextmanager
from enum import StrEnum
from typing import Any, override

import psycopg2.errors
import psycopg2.extras
import psycopg2.pool
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


class PGVectorIndexType(StrEnum):
    HNSW = "hnsw"
    DISKANN = "diskann"


class PGVectorDiskannExtension(StrEnum):
    PG_DISKANN = "pg_diskann"
    VECTORSCALE = "vectorscale"


class PGVectorConfig(BaseModel):
    """Connection and index settings for the PGVector backend."""

    host: str
    port: int
    user: str
    password: str
    database: str
    min_connection: int
    max_connection: int
    pg_bigm: bool = False
    index_type: PGVectorIndexType | str = PGVectorIndexType.HNSW
    diskann_extension: PGVectorDiskannExtension | str = PGVectorDiskannExtension.PG_DISKANN

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict[str, Any]):
        if not values["host"]:
            raise ValueError("config PGVECTOR_HOST is required")
        if not values["port"]:
            raise ValueError("config PGVECTOR_PORT is required")
        if not values["user"]:
            raise ValueError("config PGVECTOR_USER is required")
        if not values["password"]:
            raise ValueError("config PGVECTOR_PASSWORD is required")
        if not values["database"]:
            raise ValueError("config PGVECTOR_DATABASE is required")
        if not values["min_connection"]:
            raise ValueError("config PGVECTOR_MIN_CONNECTION is required")
        if not values["max_connection"]:
            raise ValueError("config PGVECTOR_MAX_CONNECTION is required")
        if values["min_connection"] > values["max_connection"]:
            raise ValueError("config PGVECTOR_MIN_CONNECTION should less than PGVECTOR_MAX_CONNECTION")
        index_type = str(values.get("index_type", PGVectorIndexType.HNSW)).lower()
        try:
            values["index_type"] = PGVectorIndexType(index_type)
        except ValueError as exc:
            raise ValueError("config PGVECTOR_INDEX_TYPE should be hnsw or diskann") from exc
        diskann_extension = str(values.get("diskann_extension", PGVectorDiskannExtension.PG_DISKANN)).lower()
        try:
            values["diskann_extension"] = PGVectorDiskannExtension(diskann_extension)
        except ValueError as exc:
            raise ValueError("config PGVECTOR_DISKANN_EXTENSION should be pg_diskann or vectorscale") from exc
        return values


SQL_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS {table_name} (
    id UUID PRIMARY KEY,
    text TEXT NOT NULL,
    meta JSONB NOT NULL,
    embedding vector({dimension}) NOT NULL
) using heap;
"""

SQL_CREATE_INDEX = """
CREATE INDEX IF NOT EXISTS embedding_cosine_v1_idx_{index_hash} ON {table_name}
USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
"""

SQL_CREATE_INDEX_DISKANN = """
CREATE INDEX IF NOT EXISTS embedding_diskann_v1_idx_{index_hash} ON {table_name}
USING diskann (embedding vector_cosine_ops){index_options};
"""

SQL_CREATE_INDEX_PG_BIGM = """
CREATE INDEX IF NOT EXISTS bigm_idx_{index_hash} ON {table_name}
USING gin (text gin_bigm_ops);
"""


class PGVector(BaseVector):
    index_type: PGVectorIndexType
    diskann_extension: PGVectorDiskannExtension

    def __init__(self, collection_name: str, config: PGVectorConfig):
        super().__init__(collection_name)
        self.pool = self._create_connection_pool(config)
        self.table_name = f"embedding_{collection_name}"
        self.index_hash = hashlib.md5(self.table_name.encode()).hexdigest()[:8]
        self.pg_bigm = config.pg_bigm
        self.index_type = PGVectorIndexType(config.index_type)
        self.diskann_extension = PGVectorDiskannExtension(config.diskann_extension)

    @override
    def get_type(self) -> str:
        return VectorType.PGVECTOR

    def _create_connection_pool(self, config: PGVectorConfig):
        return psycopg2.pool.SimpleConnectionPool(
            config.min_connection,
            config.max_connection,
            host=config.host,
            port=config.port,
            user=config.user,
            password=config.password,
            database=config.database,
        )

    @contextmanager
    def _get_cursor(self):
        conn = self.pool.getconn()
        cur = conn.cursor()
        try:
            yield cur
        except Exception:
            conn.rollback()
            raise
        else:
            conn.commit()
        finally:
            cur.close()
            self.pool.putconn(conn)

    @override
    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        dimension = len(embeddings[0])
        self._create_collection(dimension, create_vector_index=self.index_type != PGVectorIndexType.DISKANN)
        pks = self.add_texts(texts, embeddings)
        if self.index_type == PGVectorIndexType.DISKANN:
            self._create_vector_index(dimension)
        return pks

    @override
    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        values = []
        pks = []
        for i, doc in enumerate(documents):
            if doc.metadata is not None:
                doc_id = doc.metadata.get("doc_id", str(uuid.uuid4()))
                pks.append(doc_id)
                values.append(
                    (
                        doc_id,
                        doc.page_content,
                        json.dumps(doc.metadata),
                        embeddings[i],
                    )
                )
        with self._get_cursor() as cur:
            psycopg2.extras.execute_values(
                cur, f"INSERT INTO {self.table_name} (id, text, meta, embedding) VALUES %s", values
            )
        return pks

    @override
    def text_exists(self, id: str) -> bool:
        with self._get_cursor() as cur:
            cur.execute(f"SELECT id FROM {self.table_name} WHERE id = %s", (id,))
            return cur.fetchone() is not None

    def get_by_ids(self, ids: list[str]) -> list[Document]:
        with self._get_cursor() as cur:
            cur.execute(f"SELECT meta, text FROM {self.table_name} WHERE id IN %s", (tuple(ids),))
            docs = []
            for record in cur:
                docs.append(Document(page_content=record[1], metadata=record[0]))
        return docs

    @override
    def delete_by_ids(self, ids: list[str]):
        # Avoiding crashes caused by performing delete operations on empty lists in certain scenarios
        # Scenario 1: extract a document fails, resulting in a table not being created.
        # Then clicking the retry button triggers a delete operation on an empty list.
        if not ids:
            return
        with self._get_cursor() as cur:
            try:
                cur.execute(f"DELETE FROM {self.table_name} WHERE id IN %s", (tuple(ids),))
            except psycopg2.errors.UndefinedTable:
                # table not exists
                logger.warning("Table %s not found, skipping delete operation.", self.table_name)
                return
            except Exception as e:
                raise e

    @override
    def delete_by_metadata_field(self, key: str, value: str):
        with self._get_cursor() as cur:
            cur.execute(f"DELETE FROM {self.table_name} WHERE meta->>%s = %s", (key, value))

    @override
    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        """
        Search the nearest neighbors to a vector.

        :param query_vector: The input vector to search for similar items.
        :return: List of Documents that are nearest to the query vector.
        """
        top_k = kwargs.get("top_k", 4)
        if not isinstance(top_k, int) or top_k <= 0:
            raise ValueError("top_k must be a positive integer")
        document_ids_filter = kwargs.get("document_ids_filter")
        where_clause = ""
        if document_ids_filter:
            document_ids = ", ".join(f"'{id}'" for id in document_ids_filter)
            where_clause = f" WHERE meta->>'document_id' in ({document_ids}) "

        with self._get_cursor() as cur:
            cur.execute(
                f"SELECT meta, text, embedding <=> %s AS distance FROM {self.table_name}"
                f" {where_clause}"
                f" ORDER BY distance LIMIT {top_k}",
                (json.dumps(query_vector),),
            )
            docs = []
            score_threshold = float(kwargs.get("score_threshold") or 0.0)
            for record in cur:
                metadata, text, distance = record
                score = 1 - distance
                metadata["score"] = score
                if score >= score_threshold:
                    docs.append(Document(page_content=text, metadata=metadata))
        return docs

    @override
    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 5)
        if not isinstance(top_k, int) or top_k <= 0:
            raise ValueError("top_k must be a positive integer")
        with self._get_cursor() as cur:
            document_ids_filter = kwargs.get("document_ids_filter")
            where_clause = ""
            if document_ids_filter:
                document_ids = ", ".join(f"'{id}'" for id in document_ids_filter)
                where_clause = f" AND meta->>'document_id' in ({document_ids}) "
            if self.pg_bigm:
                cur.execute("SET pg_bigm.similarity_limit TO 0.000001")
                cur.execute(
                    f"""SELECT meta, text, bigm_similarity(unistr(%s), coalesce(text, '')) AS score
                    FROM {self.table_name}
                    WHERE text =%% unistr(%s)
                    {where_clause}
                    ORDER BY score DESC
                    LIMIT {top_k}""",
                    # f"'{query}'" is required in order to account for whitespace in query
                    (f"'{query}'", f"'{query}'"),
                )
            else:
                cur.execute(
                    f"""SELECT meta, text, ts_rank(to_tsvector(coalesce(text, '')), plainto_tsquery(%s)) AS score
                    FROM {self.table_name}
                    WHERE to_tsvector(text) @@ plainto_tsquery(%s)
                    {where_clause}
                    ORDER BY score DESC
                    LIMIT {top_k}""",
                    # f"'{query}'" is required in order to account for whitespace in query
                    (f"'{query}'", f"'{query}'"),
                )

            docs = []

            for record in cur:
                metadata, text, score = record
                metadata["score"] = score
                docs.append(Document(page_content=text, metadata=metadata))

        return docs

    @override
    def delete(self):
        with self._get_cursor() as cur:
            cur.execute(f"DROP TABLE IF EXISTS {self.table_name}")

    def _format_diskann_index_options(self, dimension: int) -> str:
        if self.diskann_extension != PGVectorDiskannExtension.PG_DISKANN or dimension <= 2000:
            return ""
        return " WITH (product_quantized = true, pq_param_num_chunks = 0)"

    def _create_collection(self, dimension: int, create_vector_index: bool = True):
        cache_key = f"vector_collection_{self._collection_name}_{self.index_type}"
        lock_name = f"{cache_key}_lock"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = cache_key
            if redis_client.get(collection_exist_cache_key):
                return

            with self._get_cursor() as cur:
                cur.execute("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
                if not cur.fetchone():
                    cur.execute("CREATE EXTENSION vector")
                if self.index_type == PGVectorIndexType.DISKANN:
                    cur.execute("SELECT 1 FROM pg_extension WHERE extname = %s", (self.diskann_extension.value,))
                    if not cur.fetchone():
                        cur.execute(f"CREATE EXTENSION IF NOT EXISTS {self.diskann_extension.value} CASCADE")

                cur.execute(SQL_CREATE_TABLE.format(table_name=self.table_name, dimension=dimension))
                # PG hnsw index only support 2000 dimension or less
                # ref: https://github.com/pgvector/pgvector?tab=readme-ov-file#indexing
                if create_vector_index:
                    self._execute_vector_index_sql(cur, dimension)
                if self.pg_bigm:
                    cur.execute(SQL_CREATE_INDEX_PG_BIGM.format(table_name=self.table_name, index_hash=self.index_hash))
            redis_client.set(collection_exist_cache_key, 1, ex=3600)

    def _execute_vector_index_sql(self, cur, dimension: int):
        if self.index_type == PGVectorIndexType.HNSW and dimension <= 2000:
            cur.execute(SQL_CREATE_INDEX.format(table_name=self.table_name, index_hash=self.index_hash))
        elif self.index_type == PGVectorIndexType.DISKANN:
            cur.execute(
                SQL_CREATE_INDEX_DISKANN.format(
                    table_name=self.table_name,
                    index_hash=self.index_hash,
                    index_options=self._format_diskann_index_options(dimension),
                )
            )

    def _create_vector_index(self, dimension: int):
        cache_key = f"vector_indexing_{self._collection_name}_{self.index_type}"
        lock_name = f"{cache_key}_lock"
        with redis_client.lock(lock_name, timeout=20):
            if redis_client.get(cache_key):
                return

            try:
                with self._get_cursor() as cur:
                    self._execute_vector_index_sql(cur, dimension)
            except psycopg2.errors.InternalError as exc:
                if self.diskann_extension == PGVectorDiskannExtension.PG_DISKANN and "PQError" in str(exc):
                    logger.warning(
                        "Skipping pg_diskann index creation for %s after a PQ training error. "
                        "The table remains usable without ANN index; retry after more vectors are loaded.",
                        self.table_name,
                    )
                    return
                raise
            redis_client.set(cache_key, 1, ex=3600)


class PGVectorFactory(AbstractVectorFactory):
    @override
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> PGVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.PGVECTOR, collection_name))

        return PGVector(
            collection_name=collection_name,
            config=PGVectorConfig(
                host=dify_config.PGVECTOR_HOST or "localhost",
                port=dify_config.PGVECTOR_PORT,
                user=dify_config.PGVECTOR_USER or "postgres",
                password=dify_config.PGVECTOR_PASSWORD or "",
                database=dify_config.PGVECTOR_DATABASE or "postgres",
                min_connection=dify_config.PGVECTOR_MIN_CONNECTION,
                max_connection=dify_config.PGVECTOR_MAX_CONNECTION,
                pg_bigm=dify_config.PGVECTOR_PG_BIGM,
                index_type=dify_config.PGVECTOR_INDEX_TYPE,
                diskann_extension=dify_config.PGVECTOR_DISKANN_EXTENSION,
            ),
        )
