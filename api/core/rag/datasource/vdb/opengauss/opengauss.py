import json
import uuid
from contextlib import contextmanager
from typing import Any

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


class OpenGaussConfig(BaseModel):
    host: str
    port: int
    user: str
    password: str
    database: str
    min_connection: int
    max_connection: int
    enable_pq: bool = False  # Enable PQ acceleration

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict):
        if not values["host"]:
            raise ValueError("config OPENGAUSS_HOST is required")
        if not values["port"]:
            raise ValueError("config OPENGAUSS_PORT is required")
        if not values["user"]:
            raise ValueError("config OPENGAUSS_USER is required")
        if not values["password"]:
            raise ValueError("config OPENGAUSS_PASSWORD is required")
        if not values["database"]:
            raise ValueError("config OPENGAUSS_DATABASE is required")
        if not values["min_connection"]:
            raise ValueError("config OPENGAUSS_MIN_CONNECTION is required")
        if not values["max_connection"]:
            raise ValueError("config OPENGAUSS_MAX_CONNECTION is required")
        if values["min_connection"] > values["max_connection"]:
            raise ValueError("config OPENGAUSS_MIN_CONNECTION should less than OPENGAUSS_MAX_CONNECTION")
        return values


SQL_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS {table_name} (
    id UUID PRIMARY KEY,
    text TEXT NOT NULL,
    meta JSONB NOT NULL,
    embedding vector({dimension}) NOT NULL
);
"""

SQL_CREATE_INDEX_PQ = """
CREATE INDEX IF NOT EXISTS embedding_{table_name}_pq_idx ON {table_name}
USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64, enable_pq=on, pq_m={pq_m});
"""

SQL_CREATE_INDEX = """
CREATE INDEX IF NOT EXISTS embedding_cosine_{table_name}_idx ON {table_name}
USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
"""


class OpenGauss(BaseVector):
    def __init__(self, collection_name: str, config: OpenGaussConfig):
        super().__init__(collection_name)
        self.pool = self._create_connection_pool(config)
        self.table_name = f"embedding_{collection_name}"
        self.pq_enabled = config.enable_pq

    def get_type(self) -> str:
        return VectorType.OPENGAUSS

    def _create_connection_pool(self, config: OpenGaussConfig):
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
        finally:
            cur.close()
            conn.commit()
            self.pool.putconn(conn)

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        dimension = len(embeddings[0])
        self._create_collection(dimension)
        self.add_texts(texts, embeddings)
        self._create_index(dimension)

    def _create_index(self, dimension: int):
        index_cache_key = f"vector_index_{self._collection_name}"
        lock_name = f"{index_cache_key}_lock"
        with redis_client.lock(lock_name, timeout=60):
            index_exist_cache_key = f"vector_index_{self._collection_name}"
            if redis_client.get(index_exist_cache_key):
                return

            with self._get_cursor() as cur:
                if dimension <= 2000:
                    if self.pq_enabled:
                        cur.execute(SQL_CREATE_INDEX_PQ.format(table_name=self.table_name, pq_m=int(dimension / 4)))
                        cur.execute("SET hnsw_earlystop_threshold = 320")

                    if not self.pq_enabled:
                        cur.execute(SQL_CREATE_INDEX.format(table_name=self.table_name))
            redis_client.set(index_exist_cache_key, 1, ex=3600)

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

    def delete_by_ids(self, ids: list[str]):
        # Avoiding crashes caused by performing delete operations on empty lists in certain scenarios
        # Scenario 1: extract a document fails, resulting in a table not being created.
        # Then clicking the retry button triggers a delete operation on an empty list.
        if not ids:
            return
        with self._get_cursor() as cur:
            cur.execute(f"DELETE FROM {self.table_name} WHERE id IN %s", (tuple(ids),))

    def delete_by_metadata_field(self, key: str, value: str):
        with self._get_cursor() as cur:
            cur.execute(f"DELETE FROM {self.table_name} WHERE meta->>%s = %s", (key, value))

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        """
        Search the nearest neighbors to a vector.

        :param query_vector: The input vector to search for similar items.
        :return: List of Documents that are nearest to the query vector.
        """
        top_k = kwargs.get("top_k", 4)
        if not isinstance(top_k, int) or top_k <= 0:
            raise ValueError("top_k must be a positive integer")
        with self._get_cursor() as cur:
            cur.execute(
                f"SELECT meta, text, embedding <=> %s AS distance FROM {self.table_name}"
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

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 5)
        if not isinstance(top_k, int) or top_k <= 0:
            raise ValueError("top_k must be a positive integer")
        with self._get_cursor() as cur:
            cur.execute(
                f"""SELECT meta, text, ts_rank(to_tsvector(coalesce(text, '')), plainto_tsquery(%s)) AS score
                FROM {self.table_name}
                WHERE to_tsvector(text) @@ plainto_tsquery(%s)
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

    def delete(self):
        with self._get_cursor() as cur:
            cur.execute(f"DROP TABLE IF EXISTS {self.table_name}")

    def _create_collection(self, dimension: int):
        cache_key = f"vector_indexing_{self._collection_name}"
        lock_name = f"{cache_key}_lock"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                return

            with self._get_cursor() as cur:
                cur.execute(SQL_CREATE_TABLE.format(table_name=self.table_name, dimension=dimension))
            redis_client.set(collection_exist_cache_key, 1, ex=3600)


class OpenGaussFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> OpenGauss:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.OPENGAUSS, collection_name))

        return OpenGauss(
            collection_name=collection_name,
            config=OpenGaussConfig(
                host=dify_config.OPENGAUSS_HOST or "localhost",
                port=dify_config.OPENGAUSS_PORT,
                user=dify_config.OPENGAUSS_USER or "postgres",
                password=dify_config.OPENGAUSS_PASSWORD or "",
                database=dify_config.OPENGAUSS_DATABASE or "dify",
                min_connection=dify_config.OPENGAUSS_MIN_CONNECTION,
                max_connection=dify_config.OPENGAUSS_MAX_CONNECTION,
                enable_pq=dify_config.OPENGAUSS_ENABLE_PQ or False,
            ),
        )
