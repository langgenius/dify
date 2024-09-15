import json
import uuid
from typing import Any, Optional

from pydantic import BaseModel, model_validator
from sqlalchemy import Column, Sequence, String, Table, create_engine, insert
from sqlalchemy import text as sql_text
from sqlalchemy.dialects.postgresql import JSON, TEXT
from sqlalchemy.orm import Session

from core.rag.datasource.entity.embedding import Embeddings
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from models.dataset import Dataset

try:
    from sqlalchemy.orm import declarative_base
except ImportError:
    from sqlalchemy.ext.declarative import declarative_base

from configs import dify_config
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.models.document import Document
from extensions.ext_redis import redis_client

Base = declarative_base()  # type: Any


class RelytConfig(BaseModel):
    host: str
    port: int
    user: str
    password: str
    database: str

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict) -> dict:
        if not values["host"]:
            raise ValueError("config RELYT_HOST is required")
        if not values["port"]:
            raise ValueError("config RELYT_PORT is required")
        if not values["user"]:
            raise ValueError("config RELYT_USER is required")
        if not values["password"]:
            raise ValueError("config RELYT_PASSWORD is required")
        if not values["database"]:
            raise ValueError("config RELYT_DATABASE is required")
        return values


class RelytVector(BaseVector):
    def __init__(self, collection_name: str, config: RelytConfig, group_id: str):
        super().__init__(collection_name)
        self.embedding_dimension = 1536
        self._client_config = config
        self._url = (
            f"postgresql+psycopg2://{config.user}:{config.password}@{config.host}:{config.port}/{config.database}"
        )
        self.client = create_engine(self._url)
        self._fields = []
        self._group_id = group_id

    def get_type(self) -> str:
        return VectorType.RELYT

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        index_params = {}
        metadatas = [d.metadata for d in texts]
        self.create_collection(len(embeddings[0]))
        self.embedding_dimension = len(embeddings[0])
        self.add_texts(texts, embeddings)

    def create_collection(self, dimension: int):
        lock_name = "vector_indexing_lock_{}".format(self._collection_name)
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = "vector_indexing_{}".format(self._collection_name)
            if redis_client.get(collection_exist_cache_key):
                return
            index_name = f"{self._collection_name}_embedding_index"
            with Session(self.client) as session:
                drop_statement = sql_text(f"""DROP TABLE IF EXISTS "{self._collection_name}"; """)
                session.execute(drop_statement)
                create_statement = sql_text(f"""
                    CREATE TABLE IF NOT EXISTS "{self._collection_name}" (
                        id TEXT PRIMARY KEY,
                        document TEXT NOT NULL,
                        metadata JSON NOT NULL,
                        embedding vector({dimension}) NOT NULL
                    ) using heap;
                """)
                session.execute(create_statement)
                index_statement = sql_text(f"""
                        CREATE INDEX {index_name}
                        ON "{self._collection_name}" USING vectors(embedding vector_l2_ops)
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
        from pgvecto_rs.sqlalchemy import VECTOR

        ids = [str(uuid.uuid1()) for _ in documents]
        metadatas = [d.metadata for d in documents]
        for metadata in metadatas:
            metadata["group_id"] = self._group_id
        texts = [d.page_content for d in documents]

        # Define the table schema
        chunks_table = Table(
            self._collection_name,
            Base.metadata,
            Column("id", TEXT, primary_key=True),
            Column("embedding", VECTOR(len(embeddings[0]))),
            Column("document", String, nullable=True),
            Column("metadata", JSON, nullable=True),
            extend_existing=True,
        )

        chunks_table_data = []
        with self.client.connect() as conn, conn.begin():
            for document, metadata, chunk_id, embedding in zip(texts, metadatas, ids, embeddings):
                chunks_table_data.append(
                    {
                        "id": chunk_id,
                        "embedding": embedding,
                        "document": document,
                        "metadata": metadata,
                    }
                )

                # Execute the batch insert when the batch size is reached
                if len(chunks_table_data) == 500:
                    conn.execute(insert(chunks_table).values(chunks_table_data))
                    # Clear the chunks_table_data list for the next batch
                    chunks_table_data.clear()

            # Insert any remaining records that didn't make up a full batch
            if chunks_table_data:
                conn.execute(insert(chunks_table).values(chunks_table_data))

        return ids

    def get_ids_by_metadata_field(self, key: str, value: str):
        result = None
        with Session(self.client) as session:
            select_statement = sql_text(
                f"""SELECT id FROM "{self._collection_name}" WHERE metadata->>'{key}' = '{value}'; """
            )
            result = session.execute(select_statement).fetchall()
        if result:
            return [item[0] for item in result]
        else:
            return None

    def delete_by_uuids(self, ids: list[str] = None):
        """Delete by vector IDs.

        Args:
            ids: List of ids to delete.
        """
        from pgvecto_rs.sqlalchemy import VECTOR

        if ids is None:
            raise ValueError("No ids provided to delete.")

        # Define the table schema
        chunks_table = Table(
            self._collection_name,
            Base.metadata,
            Column("id", TEXT, primary_key=True),
            Column("embedding", VECTOR(self.embedding_dimension)),
            Column("document", String, nullable=True),
            Column("metadata", JSON, nullable=True),
            extend_existing=True,
        )

        try:
            with self.client.connect() as conn, conn.begin():
                delete_condition = chunks_table.c.id.in_(ids)
                conn.execute(chunks_table.delete().where(delete_condition))
                return True
        except Exception as e:
            print("Delete operation failed:", str(e))
            return False

    def delete_by_metadata_field(self, key: str, value: str):
        ids = self.get_ids_by_metadata_field(key, value)
        if ids:
            self.delete_by_uuids(ids)

    def delete_by_ids(self, ids: list[str]) -> None:
        with Session(self.client) as session:
            ids_str = ",".join(f"'{doc_id}'" for doc_id in ids)
            select_statement = sql_text(
                f"""SELECT id FROM "{self._collection_name}" WHERE metadata->>'doc_id' in ({ids_str}); """
            )
            result = session.execute(select_statement).fetchall()
        if result:
            ids = [item[0] for item in result]
            self.delete_by_uuids(ids)

    def delete(self) -> None:
        with Session(self.client) as session:
            session.execute(sql_text(f"""DROP TABLE IF EXISTS "{self._collection_name}";"""))
            session.commit()

    def text_exists(self, id: str) -> bool:
        with Session(self.client) as session:
            select_statement = sql_text(
                f"""SELECT id FROM "{self._collection_name}" WHERE metadata->>'doc_id' = '{id}' limit 1; """
            )
            result = session.execute(select_statement).fetchall()
        return len(result) > 0

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        results = self.similarity_search_with_score_by_vector(
            k=int(kwargs.get("top_k")), embedding=query_vector, filter=kwargs.get("filter")
        )

        # Organize results.
        docs = []
        for document, score in results:
            score_threshold = float(kwargs.get("score_threshold") or 0.0)
            if 1 - score > score_threshold:
                docs.append(document)
        return docs

    def similarity_search_with_score_by_vector(
        self,
        embedding: list[float],
        k: int = 4,
        filter: Optional[dict] = None,
    ) -> list[tuple[Document, float]]:
        # Add the filter if provided
        try:
            from sqlalchemy.engine import Row
        except ImportError:
            raise ImportError("Could not import Row from sqlalchemy.engine. Please 'pip install sqlalchemy>=1.4'.")

        filter_condition = ""
        if filter is not None:
            conditions = [
                f"metadata->>{key!r} in ({', '.join(map(repr, value))})"
                if len(value) > 1
                else f"metadata->>{key!r} = {value[0]!r}"
                for key, value in filter.items()
            ]
            filter_condition = f"WHERE {' AND '.join(conditions)}"

        # Define the base query
        sql_query = f"""
            set vectors.enable_search_growing = on;
            set vectors.enable_search_write = on;
            SELECT document, metadata, embedding <-> :embedding as distance
            FROM "{self._collection_name}"
            {filter_condition}
            ORDER BY embedding <-> :embedding
            LIMIT :k
        """

        # Set up the query parameters
        embedding_str = ", ".join(format(x) for x in embedding)
        embedding_str = "[" + embedding_str + "]"
        params = {"embedding": embedding_str, "k": k}

        # Execute the query and fetch the results
        with self.client.connect() as conn:
            results: Sequence[Row] = conn.execute(sql_text(sql_query), params).fetchall()

        documents_with_scores = [
            (
                Document(
                    page_content=result.document,
                    metadata=result.metadata,
                ),
                result.distance,
            )
            for result in results
        ]
        return documents_with_scores

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        # milvus/zilliz/relyt doesn't support bm25 search
        return []


class RelytVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> RelytVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.RELYT, collection_name))

        return RelytVector(
            collection_name=collection_name,
            config=RelytConfig(
                host=dify_config.RELYT_HOST,
                port=dify_config.RELYT_PORT,
                user=dify_config.RELYT_USER,
                password=dify_config.RELYT_PASSWORD,
                database=dify_config.RELYT_DATABASE,
            ),
            group_id=dataset.id,
        )
