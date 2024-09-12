import json
import logging
from typing import Any
from uuid import UUID, uuid4

from numpy import ndarray
from pgvecto_rs.sqlalchemy import VECTOR
from pydantic import BaseModel, model_validator
from sqlalchemy import Float, String, create_engine, insert, select, text
from sqlalchemy import text as sql_text
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, Session, mapped_column

from configs import dify_config
from core.rag.datasource.entity.embedding import Embeddings
from core.rag.datasource.vdb.pgvecto_rs.collection import CollectionORM
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)


class PgvectoRSConfig(BaseModel):
    host: str
    port: int
    user: str
    password: str
    database: str

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict) -> dict:
        if not values["host"]:
            raise ValueError("config PGVECTO_RS_HOST is required")
        if not values["port"]:
            raise ValueError("config PGVECTO_RS_PORT is required")
        if not values["user"]:
            raise ValueError("config PGVECTO_RS_USER is required")
        if not values["password"]:
            raise ValueError("config PGVECTO_RS_PASSWORD is required")
        if not values["database"]:
            raise ValueError("config PGVECTO_RS_DATABASE is required")
        return values


class PGVectoRS(BaseVector):
    def __init__(self, collection_name: str, config: PgvectoRSConfig, dim: int):
        super().__init__(collection_name)
        self._client_config = config
        self._url = (
            f"postgresql+psycopg2://{config.user}:{config.password}@{config.host}:{config.port}/{config.database}"
        )
        self._client = create_engine(self._url)
        with Session(self._client) as session:
            session.execute(text("CREATE EXTENSION IF NOT EXISTS vectors"))
            session.commit()
        self._fields = []

        class _Table(CollectionORM):
            __tablename__ = collection_name
            __table_args__ = {"extend_existing": True}
            id: Mapped[UUID] = mapped_column(
                postgresql.UUID(as_uuid=True),
                primary_key=True,
            )
            text: Mapped[str] = mapped_column(String)
            meta: Mapped[dict] = mapped_column(postgresql.JSONB)
            vector: Mapped[ndarray] = mapped_column(VECTOR(dim))

        self._table = _Table
        self._distance_op = "<=>"

    def get_type(self) -> str:
        return VectorType.PGVECTO_RS

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        self.create_collection(len(embeddings[0]))
        self.add_texts(texts, embeddings)

    def create_collection(self, dimension: int):
        lock_name = "vector_indexing_lock_{}".format(self._collection_name)
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = "vector_indexing_{}".format(self._collection_name)
            if redis_client.get(collection_exist_cache_key):
                return
            index_name = f"{self._collection_name}_embedding_index"
            with Session(self._client) as session:
                create_statement = sql_text(f"""
                    CREATE TABLE IF NOT EXISTS {self._collection_name} (
                        id UUID PRIMARY KEY,
                        text TEXT NOT NULL,
                        meta JSONB NOT NULL,
                        vector vector({dimension}) NOT NULL
                    ) using heap;
                """)
                session.execute(create_statement)
                index_statement = sql_text(f"""
                        CREATE INDEX IF NOT EXISTS {index_name}
                        ON {self._collection_name} USING vectors(vector vector_l2_ops)
                        WITH (options = $$
                                optimizing.optimizing_threads = 30
                                segment.max_growing_segment_size = 2000
                                segment.max_sealed_segment_size = 30000000
                                [indexing.hnsw]
                                m=30
                                ef_construction=500
                                $$);
                    """)
                session.execute(index_statement)
                session.commit()
            redis_client.set(collection_exist_cache_key, 1, ex=3600)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        pks = []
        with Session(self._client) as session:
            for document, embedding in zip(documents, embeddings):
                pk = uuid4()
                session.execute(
                    insert(self._table).values(
                        id=pk,
                        text=document.page_content,
                        meta=document.metadata,
                        vector=embedding,
                    ),
                )
                pks.append(pk)
            session.commit()

        return pks

    def get_ids_by_metadata_field(self, key: str, value: str):
        result = None
        with Session(self._client) as session:
            select_statement = sql_text(f"SELECT id FROM {self._collection_name} WHERE meta->>'{key}' = '{value}'; ")
            result = session.execute(select_statement).fetchall()
        if result:
            return [item[0] for item in result]
        else:
            return None

    def delete_by_metadata_field(self, key: str, value: str):
        ids = self.get_ids_by_metadata_field(key, value)
        if ids:
            with Session(self._client) as session:
                select_statement = sql_text(f"DELETE FROM {self._collection_name} WHERE id = ANY(:ids)")
                session.execute(select_statement, {"ids": ids})
                session.commit()

    def delete_by_ids(self, ids: list[str]) -> None:
        with Session(self._client) as session:
            select_statement = sql_text(
                f"SELECT id FROM {self._collection_name} WHERE meta->>'doc_id' = ANY (:doc_ids); "
            )
            result = session.execute(select_statement, {"doc_ids": ids}).fetchall()
        if result:
            ids = [item[0] for item in result]
            if ids:
                with Session(self._client) as session:
                    select_statement = sql_text(f"DELETE FROM {self._collection_name} WHERE id = ANY(:ids)")
                    session.execute(select_statement, {"ids": ids})
                    session.commit()

    def delete(self) -> None:
        with Session(self._client) as session:
            session.execute(sql_text(f"DROP TABLE IF EXISTS {self._collection_name}"))
            session.commit()

    def text_exists(self, id: str) -> bool:
        with Session(self._client) as session:
            select_statement = sql_text(
                f"SELECT id FROM {self._collection_name} WHERE meta->>'doc_id' = '{id}' limit 1; "
            )
            result = session.execute(select_statement).fetchall()
        return len(result) > 0

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        with Session(self._client) as session:
            stmt = (
                select(
                    self._table,
                    self._table.vector.op(self._distance_op, return_type=Float)(
                        query_vector,
                    ).label("distance"),
                )
                .limit(kwargs.get("top_k", 2))
                .order_by("distance")
            )
            res = session.execute(stmt)
            results = [(row[0], row[1]) for row in res]

        # Organize results.
        docs = []
        for record, dis in results:
            metadata = record.meta
            score = 1 - dis
            metadata["score"] = score
            score_threshold = kwargs.get("score_threshold", 0.0)
            if score > score_threshold:
                doc = Document(page_content=record.text, metadata=metadata)
                docs.append(doc)
        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        # with Session(self._client) as session:
        #     select_statement = sql_text(
        #         f"SELECT text, meta FROM {self._collection_name} WHERE to_tsvector(text) @@ '{query}'::tsquery"
        #     )
        #     results = session.execute(select_statement).fetchall()
        # if results:
        #     docs = []
        #     for result in results:
        #         doc = Document(page_content=result[0],
        #                        metadata=result[1])
        #         docs.append(doc)
        #     return docs
        return []


class PGVectoRSFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> PGVectoRS:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix.lower()
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id).lower()
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.WEAVIATE, collection_name))
        dim = len(embeddings.embed_query("pgvecto_rs"))

        return PGVectoRS(
            collection_name=collection_name,
            config=PgvectoRSConfig(
                host=dify_config.PGVECTO_RS_HOST,
                port=dify_config.PGVECTO_RS_PORT,
                user=dify_config.PGVECTO_RS_USER,
                password=dify_config.PGVECTO_RS_PASSWORD,
                database=dify_config.PGVECTO_RS_DATABASE,
            ),
            dim=dim,
        )
