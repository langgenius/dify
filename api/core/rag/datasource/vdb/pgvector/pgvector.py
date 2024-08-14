import json
import uuid
from contextlib import contextmanager
from typing import Any

import psycopg2.extras
import psycopg2.pool
from pydantic import BaseModel, model_validator

from configs import dify_config
from core.rag.datasource.entity.embedding import Embeddings
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset


class PGVectorConfig(BaseModel):
    host: str
    port: int
    user: str
    password: str
    database: str

    @model_validator(mode='before')
    def validate_config(cls, values: dict) -> dict:
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
        return values


SQL_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS {table_name} (
    id UUID PRIMARY KEY,
    text TEXT NOT NULL,
    meta JSONB NOT NULL,
    embedding vector({dimension}) NOT NULL
) using heap;
"""


class PGVector(BaseVector):
    def __init__(self, collection_name: str, config: PGVectorConfig):
        super().__init__(collection_name)
        self.pool = self._create_connection_pool(config)
        self.table_name = f"embedding_{collection_name}"

    def get_type(self) -> str:
        return VectorType.PGVECTOR

    def _create_connection_pool(self, config: PGVectorConfig):
        return psycopg2.pool.SimpleConnectionPool(
            1,
            5,
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
        return self.add_texts(texts, embeddings)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        values = []
        pks = []
        for i, doc in enumerate(documents):
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

    def delete_by_ids(self, ids: list[str]) -> None:
        with self._get_cursor() as cur:
            cur.execute(f"DELETE FROM {self.table_name} WHERE id IN %s", (tuple(ids),))

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        with self._get_cursor() as cur:
            cur.execute(f"DELETE FROM {self.table_name} WHERE meta->>%s = %s", (key, value))

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        """
        Search the nearest neighbors to a vector.

        :param query_vector: The input vector to search for similar items.
        :param top_k: The number of nearest neighbors to return, default is 5.
        :return: List of Documents that are nearest to the query vector.
        """
        top_k = kwargs.get("top_k", 5)

        with self._get_cursor() as cur:
            cur.execute(
                f"SELECT meta, text, embedding <=> %s AS distance FROM {self.table_name} ORDER BY distance LIMIT {top_k}",
                (json.dumps(query_vector),),
            )
            docs = []
            score_threshold = kwargs.get("score_threshold") if kwargs.get("score_threshold") else 0.0
            for record in cur:
                metadata, text, distance = record
                score = 1 - distance
                metadata["score"] = score
                if score > score_threshold:
                    docs.append(Document(page_content=text, metadata=metadata))
        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        # do not support bm25 search
        return []

    def delete(self) -> None:
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
                cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
                cur.execute(SQL_CREATE_TABLE.format(table_name=self.table_name, dimension=dimension))
                # TODO: create index https://github.com/pgvector/pgvector?tab=readme-ov-file#indexing
            redis_client.set(collection_exist_cache_key, 1, ex=3600)


class PGVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> PGVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(
                self.gen_index_struct_dict(VectorType.PGVECTOR, collection_name))

        return PGVector(
            collection_name=collection_name,
            config=PGVectorConfig(
                host=dify_config.PGVECTOR_HOST,
                port=dify_config.PGVECTOR_PORT,
                user=dify_config.PGVECTOR_USER,
                password=dify_config.PGVECTOR_PASSWORD,
                database=dify_config.PGVECTOR_DATABASE,
            ),
        )
