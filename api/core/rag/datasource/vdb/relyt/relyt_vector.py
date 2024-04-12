import logging
from typing import Any

from pgvecto_rs.sdk import PGVectoRs, Record
from pydantic import BaseModel, root_validator
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.models.document import Document
from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)

class RelytConfig(BaseModel):
    host: str
    port: int
    user: str
    password: str
    database: str

    @root_validator()
    def validate_config(cls, values: dict) -> dict:
        if not values['host']:
            raise ValueError("config RELYT_HOST is required")
        if not values['port']:
            raise ValueError("config RELYT_PORT is required")
        if not values['user']:
            raise ValueError("config RELYT_USER is required")
        if not values['password']:
            raise ValueError("config RELYT_PASSWORD is required")
        if not values['database']:
            raise ValueError("config RELYT_DATABASE is required")
        return values


class RelytVector(BaseVector):

    def __init__(self, collection_name: str, config: RelytConfig, dim: int):
        super().__init__(collection_name)
        self._client_config = config
        self._url = f"postgresql+psycopg2://{config.user}:{config.password}@{config.host}:{config.port}/{config.database}"
        self._client = PGVectoRs(
            db_url=self._url,
            collection_name=self._collection_name,
            dimension=dim
        )
        self._fields = []

    def get_type(self) -> str:
        return 'relyt'

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        index_params = {}
        metadatas = [d.metadata for d in texts]
        self.create_collection(len(embeddings[0]))
        self.add_texts(texts, embeddings)

    def create_collection(self, dimension: int):
        lock_name = 'vector_indexing_lock_{}'.format(self._collection_name)
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = 'vector_indexing_{}'.format(self._collection_name)
            if redis_client.get(collection_exist_cache_key):
                return
            index_name = f"{self._collection_name}_embedding_index"
            with Session(self._client._engine) as session:
                drop_statement = sql_text(f"DROP TABLE IF EXISTS collection_{self._collection_name}")
                session.execute(drop_statement)
                create_statement = sql_text(f"""
                    CREATE TABLE IF NOT EXISTS collection_{self._collection_name} (
                        id UUID PRIMARY KEY,
                        text TEXT NOT NULL,
                        meta JSONB NOT NULL,
                        embedding vector({dimension}) NOT NULL
                    ) using heap; 
                """)
                session.execute(create_statement)
                index_statement = sql_text(f"""
                        CREATE INDEX {index_name}
                        ON collection_{self._collection_name} USING vectors(embedding vector_l2_ops)
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
        records = [Record.from_text(d.page_content, e, d.metadata) for d, e in zip(documents, embeddings)]
        pks = [str(r.id) for r in records]
        self._client.insert(records)
        return pks

    def delete_by_document_id(self, document_id: str):
        ids = self.get_ids_by_metadata_field('document_id', document_id)
        if ids:
            self._client.delete_by_ids(ids)

    def get_ids_by_metadata_field(self, key: str, value: str):
        result = None
        with Session(self._client._engine) as session:
            select_statement = sql_text(
                f"SELECT id FROM collection_{self._collection_name} WHERE meta->>'{key}' = '{value}'; "
            )
            result = session.execute(select_statement).fetchall()
        if result:
            return [item[0] for item in result]
        else:
            return None

    def delete_by_metadata_field(self, key: str, value: str):

        ids = self.get_ids_by_metadata_field(key, value)
        if ids:
            self._client.delete_by_ids(ids)

    def delete_by_ids(self, doc_ids: list[str]) -> None:
        with Session(self._client._engine) as session:
            select_statement = sql_text(
                f"SELECT id FROM collection_{self._collection_name} WHERE meta->>'doc_id' in ('{doc_ids}'); "
            )
            result = session.execute(select_statement).fetchall()
        if result:
            ids = [item[0] for item in result]
            self._client.delete_by_ids(ids)

    def delete(self) -> None:
        with Session(self._client._engine) as session:
            session.execute(sql_text(f"DROP TABLE IF EXISTS collection_{self._collection_name}"))
            session.commit()

    def text_exists(self, id: str) -> bool:
        with Session(self._client._engine) as session:
            select_statement = sql_text(
                f"SELECT id FROM collection_{self._collection_name} WHERE meta->>'doc_id' = '{id}' limit 1; "
            )
            result = session.execute(select_statement).fetchall()
        return len(result) > 0

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        from pgvecto_rs.sdk import filters
        filter_condition = filters.meta_contains(kwargs.get('filter'))
        results = self._client.search(
            top_k=int(kwargs.get('top_k')),
            embedding=query_vector,
            filter=filter_condition
        )

        # Organize results.
        docs = []
        for record, dis in results:
            metadata = record.meta
            metadata['score'] = dis
            score_threshold = kwargs.get('score_threshold') if kwargs.get('score_threshold') else 0.0
            if dis > score_threshold:
                doc = Document(page_content=record.text,
                               metadata=metadata)
                docs.append(doc)
        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        # milvus/zilliz/relyt doesn't support bm25 search
        return []
