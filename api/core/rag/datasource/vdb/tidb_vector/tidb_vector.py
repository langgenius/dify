import json
import logging
from typing import Any

import sqlalchemy
from pydantic import BaseModel, model_validator
from sqlalchemy import JSON, TEXT, Column, DateTime, String, Table, create_engine, insert
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session, declarative_base

from configs import dify_config
from core.rag.datasource.vdb.field import Field
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)


class TiDBVectorConfig(BaseModel):
    host: str
    port: int
    user: str
    password: str
    database: str
    program_name: str

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict) -> dict:
        if not values["host"]:
            raise ValueError("config TIDB_VECTOR_HOST is required")
        if not values["port"]:
            raise ValueError("config TIDB_VECTOR_PORT is required")
        if not values["user"]:
            raise ValueError("config TIDB_VECTOR_USER is required")
        if not values["database"]:
            raise ValueError("config TIDB_VECTOR_DATABASE is required")
        if not values["program_name"]:
            raise ValueError("config APPLICATION_NAME is required")
        return values


class TiDBVector(BaseVector):
    def get_type(self) -> str:
        return VectorType.TIDB_VECTOR

    def _table(self, dim: int) -> Table:
        from tidb_vector.sqlalchemy import VectorType  # type: ignore

        return Table(
            self._collection_name,
            self._orm_base.metadata,
            Column(Field.PRIMARY_KEY.value, String(36), primary_key=True, nullable=False),
            Column(
                Field.VECTOR.value,
                VectorType(dim),
                nullable=False,
            ),
            Column(Field.TEXT_KEY.value, TEXT, nullable=False),
            Column("meta", JSON, nullable=False),
            Column("create_time", DateTime, server_default=sqlalchemy.text("CURRENT_TIMESTAMP")),
            Column(
                "update_time", DateTime, server_default=sqlalchemy.text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
            ),
            extend_existing=True,
        )

    def __init__(self, collection_name: str, config: TiDBVectorConfig, distance_func: str = "cosine"):
        super().__init__(collection_name)
        self._client_config = config
        self._url = (
            f"mysql+pymysql://{config.user}:{config.password}@{config.host}:{config.port}/{config.database}?"
            f"ssl_verify_cert=true&ssl_verify_identity=true&program_name={config.program_name}"
        )
        self._distance_func = distance_func.lower()
        self._engine = create_engine(self._url)
        self._orm_base = declarative_base()
        self._dimension = 1536

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        logger.info("create collection and add texts, collection_name: " + self._collection_name)
        self._create_collection(len(embeddings[0]))
        self.add_texts(texts, embeddings)
        self._dimension = len(embeddings[0])
        pass

    def _create_collection(self, dimension: int):
        logger.info("_create_collection, collection_name " + self._collection_name)
        lock_name = "vector_indexing_lock_{}".format(self._collection_name)
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = "vector_indexing_{}".format(self._collection_name)
            if redis_client.get(collection_exist_cache_key):
                return
            tidb_dist_func = self._get_distance_func()
            with Session(self._engine) as session:
                session.begin()
                create_statement = sql_text(f"""
                    CREATE TABLE IF NOT EXISTS {self._collection_name} (
                        id CHAR(36) PRIMARY KEY,
                        text TEXT NOT NULL,
                        meta JSON NOT NULL,
                        doc_id VARCHAR(64) AS (JSON_UNQUOTE(JSON_EXTRACT(meta, '$.doc_id'))) STORED,
                        document_id VARCHAR(64) AS (JSON_UNQUOTE(JSON_EXTRACT(meta, '$.document_id'))) STORED,
                        vector VECTOR<FLOAT>({dimension}) NOT NULL,
                        create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                        update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        KEY (doc_id),
                        KEY (document_id),
                        VECTOR INDEX idx_vector (({tidb_dist_func}(vector))) USING HNSW
                    );
                """)
                session.execute(create_statement)
                session.commit()
            redis_client.set(collection_exist_cache_key, 1, ex=3600)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        table = self._table(len(embeddings[0]))
        ids = self._get_uuids(documents)
        metas = [d.metadata for d in documents]
        texts = [d.page_content for d in documents]

        chunks_table_data = []
        with self._engine.connect() as conn, conn.begin():
            for id, text, meta, embedding in zip(ids, texts, metas, embeddings):
                chunks_table_data.append({"id": id, "vector": embedding, "text": text, "meta": meta})

                # Execute the batch insert when the batch size is reached
                if len(chunks_table_data) == 500:
                    conn.execute(insert(table).values(chunks_table_data))
                    # Clear the chunks_table_data list for the next batch
                    chunks_table_data.clear()

            # Insert any remaining records that didn't make up a full batch
            if chunks_table_data:
                conn.execute(insert(table).values(chunks_table_data))
        return ids

    def text_exists(self, id: str) -> bool:
        result = self.get_ids_by_metadata_field("doc_id", id)
        return bool(result)

    def delete_by_ids(self, ids: list[str]) -> None:
        with Session(self._engine) as session:
            ids_str = ",".join(f"'{doc_id}'" for doc_id in ids)
            select_statement = sql_text(
                f"""SELECT id FROM {self._collection_name} WHERE meta->>'$.doc_id' in ({ids_str}); """
            )
            result = session.execute(select_statement).fetchall()
        if result:
            ids = [item[0] for item in result]
            self._delete_by_ids(ids)

    def _delete_by_ids(self, ids: list[str]) -> bool:
        if ids is None:
            raise ValueError("No ids provided to delete.")
        table = self._table(self._dimension)
        try:
            with self._engine.connect() as conn, conn.begin():
                delete_condition = table.c.id.in_(ids)
                conn.execute(table.delete().where(delete_condition))
                return True
        except Exception as e:
            print("Delete operation failed:", str(e))
            return False

    def get_ids_by_metadata_field(self, key: str, value: str):
        with Session(self._engine) as session:
            select_statement = sql_text(
                f"""SELECT id FROM {self._collection_name} WHERE meta->>'$.{key}' = '{value}'; """
            )
            result = session.execute(select_statement).fetchall()
        if result:
            return [item[0] for item in result]
        else:
            return None

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        ids = self.get_ids_by_metadata_field(key, value)
        if ids:
            self._delete_by_ids(ids)

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 4)
        score_threshold = float(kwargs.get("score_threshold") or 0.0)
        distance = 1 - score_threshold

        query_vector_str = ", ".join(format(x) for x in query_vector)
        query_vector_str = "[" + query_vector_str + "]"
        logger.debug(
            f"_collection_name: {self._collection_name}, score_threshold: {score_threshold}, distance: {distance}"
        )

        docs = []
        tidb_dist_func = self._get_distance_func()
        document_ids_filter = kwargs.get("document_ids_filter")
        where_clause = ""
        if document_ids_filter:
            document_ids = ", ".join(f"'{id}'" for id in document_ids_filter)
            where_clause = f" WHERE meta->>'$.document_id' in ({document_ids}) "

        with Session(self._engine) as session:
            select_statement = sql_text(f"""
                SELECT meta, text, distance
                FROM (
                  SELECT
                    meta,
                    text,
                    {tidb_dist_func}(vector, :query_vector_str) AS distance
                  FROM {self._collection_name}
                  {where_clause}
                  ORDER BY distance ASC
                  LIMIT :top_k
                ) t
                WHERE distance <= :distance
                """)
            res = session.execute(
                select_statement,
                params={
                    "query_vector_str": query_vector_str,
                    "distance": distance,
                    "top_k": top_k,
                },
            )
            results = [(row[0], row[1], row[2]) for row in res]
            for meta, text, distance in results:
                metadata = json.loads(meta)
                metadata["score"] = 1 - distance
                docs.append(Document(page_content=text, metadata=metadata))
        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        # tidb doesn't support bm25 search
        return []

    def delete(self) -> None:
        with Session(self._engine) as session:
            session.execute(sql_text(f"""DROP TABLE IF EXISTS {self._collection_name};"""))
            session.commit()

    def _get_distance_func(self) -> str:
        match self._distance_func:
            case "l2":
                tidb_dist_func = "VEC_L2_DISTANCE"
            case "cosine":
                tidb_dist_func = "VEC_COSINE_DISTANCE"
            case _:
                tidb_dist_func = "VEC_COSINE_DISTANCE"
        return tidb_dist_func


class TiDBVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> TiDBVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix.lower()
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id).lower()
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.TIDB_VECTOR, collection_name))

        return TiDBVector(
            collection_name=collection_name,
            config=TiDBVectorConfig(
                host=dify_config.TIDB_VECTOR_HOST or "",
                port=dify_config.TIDB_VECTOR_PORT or 0,
                user=dify_config.TIDB_VECTOR_USER or "",
                password=dify_config.TIDB_VECTOR_PASSWORD or "",
                database=dify_config.TIDB_VECTOR_DATABASE or "",
                program_name=dify_config.APPLICATION_NAME,
            ),
        )
