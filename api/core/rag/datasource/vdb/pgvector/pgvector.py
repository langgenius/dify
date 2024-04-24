from pgvector.sqlalchemy import Vector
from pydantic import BaseModel
from sqlalchemy import JSON, Column, MetaData, String, Table, create_engine
from sqlalchemy.engine import URL
from sqlalchemy.orm import mapped_column

from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.models.document import Document
from extensions.ext_redis import redis_client


class PGVectorConfig(BaseModel):
    host: str
    port: int
    user: str
    password: str
    database: str


def new_embedding_table(collection_name: str, dimension: int):
    metadata_obj = MetaData()
    return Table(
        f"embedding_{collection_name}",
        metadata_obj,
        Column("id", String, primary_key=True),
        Column("meta", JSON),
        Column("text", String),
        Column("embedding", mapped_column(Vector(dimension))),
    )


class PGVector(BaseVector):
    def __init__(self, collection_name: str, config: PGVectorConfig, dimension: int):
        super().__init__(collection_name)
        self.engine = self._create_engine(config)
        self.table = None

    def get_type(self) -> str:
        return "pgvector"

    def _create_engine(self, config: PGVectorConfig):
        url = URL(
            drivername="postgresql",
            username=config.user,
            password=config.password,
            host=config.host,
            port=config.port,
            database=config.database,
        )
        return create_engine(url)

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        dimension = len(embeddings[0])
        self.table = new_embedding_table(self._collection_name, dimension)
        self._create_collection()
        self.add_texts(texts, embeddings)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        data = []
        ids = []
        for i, doc in enumerate(documents):
            ids.append(doc.metadata["doc_id"])
            data.append(
                {
                    "id": doc.metadata["doc_id"],
                    "meta": doc.metadata,
                    "text": doc.page_content,
                    "embedding": embeddings[i],
                }
            )
        with self.engine.connect() as conn:
            conn.execute(self.table.insert(), data)

    def text_exists(self, id: str) -> bool:
        with self.engine.connect() as conn:
            return conn.execute(self.table.select().where(self.table.c.id == id)).fetchone() is not None

    def delete_by_ids(self, ids: list[str]) -> None:
        with self.engine.connect() as conn:
            conn.execute(self.table.delete().where(self.table.c.id.in_(ids)))

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        with self.engine.connect() as conn:
            conn.execute(self.table.delete().where(self.table.c.meta[key].astext == value))

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        """
        Search the nearest neighbors to a vector.

        :param query_vector: The input vector to search for similar items.
        :param top_k: The number of nearest neighbors to return, default is 5.
        :param distance_metric: The distance metric to use ('l2', 'max_inner_product', 'cosine').
        :return: List of Documents that are nearest to the query vector.
        """
        distance_metric = kwargs.get("distance_metric", "l2")
        top_k = kwargs.get("top_k", 5)

        # Build the order_by clause based on the distance metric specified
        if distance_metric == "l2":
            order_clause = self.table.c.embedding.l2_distance(query_vector)
        elif distance_metric == "max_inner_product":
            order_clause = self.table.c.embedding.max_inner_product(query_vector)
        elif distance_metric == "cosine":
            order_clause = self.table.c.embedding.cosine_distance(query_vector)
        else:
            raise ValueError(f"Unsupported distance metric: {distance_metric}")

        with self.engine.connect() as conn:
            results = conn.scalars(self.table.select().order_by(order_clause).limit(top_k)).all()
        docs = []
        for ret in results:
            docs.append(Document(page_content=ret.text, metadata=ret.meta))
        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        # do not support bm25 search
        return []

    def delete(self) -> None:
        with self.engine.connect() as conn:
            conn.execute(self.table.drop())

    def _create_collection(self):
        cache_key = f"vector_indexing_{self._collection_name}"
        lock_name = f"{cache_key}_lock"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                return
            with self.engine.connect() as conn:
                conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
                conn.execute(self.table.drop(if_exists=True))
                conn.execute(self.table.create())
                # TODO: create index https://github.com/pgvector/pgvector?tab=readme-ov-file#indexing
            redis_client.set(collection_exist_cache_key, 1, ex=3600)
