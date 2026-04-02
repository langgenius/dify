import json
import logging
import time
from typing import Any

import holo_search_sdk as holo  # type: ignore
from holo_search_sdk.types import BaseQuantizationType, DistanceType, TokenizerType
from psycopg import sql as psql
from pydantic import BaseModel, model_validator

from configs import dify_config
from core.rag.datasource.vdb.field import parse_metadata_json
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)


class HologresVectorConfig(BaseModel):
    """
    Configuration for Hologres vector database connection.

    In Hologres, access_key_id is used as the PostgreSQL username,
    and access_key_secret is used as the PostgreSQL password.
    """

    host: str
    port: int = 80
    database: str
    access_key_id: str
    access_key_secret: str
    schema_name: str = "public"
    tokenizer: TokenizerType = "jieba"
    distance_method: DistanceType = "Cosine"
    base_quantization_type: BaseQuantizationType = "rabitq"
    max_degree: int = 64
    ef_construction: int = 400

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict):
        if not values.get("host"):
            raise ValueError("config HOLOGRES_HOST is required")
        if not values.get("database"):
            raise ValueError("config HOLOGRES_DATABASE is required")
        if not values.get("access_key_id"):
            raise ValueError("config HOLOGRES_ACCESS_KEY_ID is required")
        if not values.get("access_key_secret"):
            raise ValueError("config HOLOGRES_ACCESS_KEY_SECRET is required")
        return values


class HologresVector(BaseVector):
    """
    Hologres vector storage implementation using holo-search-sdk.

    Supports semantic search (vector), full-text search, and hybrid search.
    """

    def __init__(self, collection_name: str, config: HologresVectorConfig):
        super().__init__(collection_name)
        self._config = config
        self._client = self._init_client(config)
        self.table_name = f"embedding_{collection_name}".lower()

    def _init_client(self, config: HologresVectorConfig):
        """Initialize and return a holo-search-sdk client."""
        client = holo.connect(
            host=config.host,
            port=config.port,
            database=config.database,
            access_key_id=config.access_key_id,
            access_key_secret=config.access_key_secret,
            schema=config.schema_name,
        )
        client.connect()
        return client

    def get_type(self) -> str:
        return VectorType.HOLOGRES

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        """Create collection table with vector and full-text indexes, then add texts."""
        dimension = len(embeddings[0])
        self._create_collection(dimension)
        self.add_texts(texts, embeddings)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        """Add texts with embeddings to the collection using batch upsert."""
        if not documents:
            return []

        pks: list[str] = []
        batch_size = 100
        for i in range(0, len(documents), batch_size):
            batch_docs = documents[i : i + batch_size]
            batch_embeddings = embeddings[i : i + batch_size]

            values = []
            column_names = ["id", "text", "meta", "embedding"]

            for j, doc in enumerate(batch_docs):
                doc_id = doc.metadata.get("doc_id", "") if doc.metadata else ""
                pks.append(doc_id)
                values.append(
                    [
                        doc_id,
                        doc.page_content,
                        json.dumps(doc.metadata or {}),
                        batch_embeddings[j],
                    ]
                )

            table = self._client.open_table(self.table_name)
            table.upsert_multi(
                index_column="id",
                values=values,
                column_names=column_names,
                update=True,
                update_columns=["text", "meta", "embedding"],
            )

        return pks

    def text_exists(self, id: str) -> bool:
        """Check if a text with the given doc_id exists in the collection."""
        if not self._client.check_table_exist(self.table_name):
            return False

        result = self._client.execute(
            psql.SQL("SELECT 1 FROM {} WHERE id = {} LIMIT 1").format(
                psql.Identifier(self.table_name), psql.Literal(id)
            ),
            fetch_result=True,
        )
        return bool(result)

    def get_ids_by_metadata_field(self, key: str, value: str) -> list[str] | None:
        """Get document IDs by metadata field key and value."""
        result = self._client.execute(
            psql.SQL("SELECT id FROM {} WHERE meta->>{} = {}").format(
                psql.Identifier(self.table_name), psql.Literal(key), psql.Literal(value)
            ),
            fetch_result=True,
        )
        if result:
            return [row[0] for row in result]
        return None

    def delete_by_ids(self, ids: list[str]):
        """Delete documents by their doc_id list."""
        if not ids:
            return
        if not self._client.check_table_exist(self.table_name):
            return

        self._client.execute(
            psql.SQL("DELETE FROM {} WHERE id IN ({})").format(
                psql.Identifier(self.table_name),
                psql.SQL(", ").join(psql.Literal(id) for id in ids),
            )
        )

    def delete_by_metadata_field(self, key: str, value: str):
        """Delete documents by metadata field key and value."""
        if not self._client.check_table_exist(self.table_name):
            return

        self._client.execute(
            psql.SQL("DELETE FROM {} WHERE meta->>{} = {}").format(
                psql.Identifier(self.table_name), psql.Literal(key), psql.Literal(value)
            )
        )

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        """Search for documents by vector similarity."""
        if not self._client.check_table_exist(self.table_name):
            return []

        top_k = kwargs.get("top_k", 4)
        score_threshold = float(kwargs.get("score_threshold") or 0.0)

        table = self._client.open_table(self.table_name)
        query = (
            table.search_vector(
                vector=query_vector,
                column="embedding",
                distance_method=self._config.distance_method,
                output_name="distance",
            )
            .select(["id", "text", "meta"])
            .limit(top_k)
        )

        # Apply document_ids_filter if provided
        document_ids_filter = kwargs.get("document_ids_filter")
        if document_ids_filter:
            filter_sql = psql.SQL("meta->>'document_id' IN ({})").format(
                psql.SQL(", ").join(psql.Literal(id) for id in document_ids_filter)
            )
            query = query.where(filter_sql)

        results = query.fetchall()
        return self._process_vector_results(results, score_threshold)

    def _process_vector_results(self, results: list, score_threshold: float) -> list[Document]:
        """Process vector search results into Document objects."""
        docs = []
        for row in results:
            # row format: (distance, id, text, meta)
            # distance is first because search_vector() adds the computed column before selected columns
            distance = row[0]
            text = row[2]
            meta = row[3]

            meta = parse_metadata_json(meta)

            # Convert distance to similarity score (consistent with pgvector)
            score = 1 - distance
            meta["score"] = score

            if score >= score_threshold:
                docs.append(Document(page_content=text, metadata=meta))

        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        """Search for documents by full-text search."""
        if not self._client.check_table_exist(self.table_name):
            return []

        top_k = kwargs.get("top_k", 4)

        table = self._client.open_table(self.table_name)
        search_query = table.search_text(
            column="text",
            expression=query,
            return_score=True,
            return_score_name="score",
            return_all_columns=True,
        ).limit(top_k)

        # Apply document_ids_filter if provided
        document_ids_filter = kwargs.get("document_ids_filter")
        if document_ids_filter:
            filter_sql = psql.SQL("meta->>'document_id' IN ({})").format(
                psql.SQL(", ").join(psql.Literal(id) for id in document_ids_filter)
            )
            search_query = search_query.where(filter_sql)

        results = search_query.fetchall()
        return self._process_full_text_results(results)

    def _process_full_text_results(self, results: list) -> list[Document]:
        """Process full-text search results into Document objects."""
        docs = []
        for row in results:
            # row format: (id, text, meta, embedding, score)
            text = row[1]
            meta = row[2]
            score = row[-1]  # score is the last column from return_score

            meta = parse_metadata_json(meta)

            meta["score"] = score
            docs.append(Document(page_content=text, metadata=meta))

        return docs

    def delete(self):
        """Delete the entire collection table."""
        if self._client.check_table_exist(self.table_name):
            self._client.drop_table(self.table_name)

    def _create_collection(self, dimension: int):
        """Create the collection table with vector and full-text indexes."""
        lock_name = f"vector_indexing_lock_{self._collection_name}"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                return

            if not self._client.check_table_exist(self.table_name):
                # Create table via SQL with CHECK constraint for vector dimension
                create_table_sql = psql.SQL("""
                    CREATE TABLE IF NOT EXISTS {} (
                        id TEXT PRIMARY KEY,
                        text TEXT NOT NULL,
                        meta JSONB NOT NULL,
                        embedding float4[] NOT NULL
                            CHECK (array_ndims(embedding) = 1
                                   AND array_length(embedding, 1) = {})
                    );
                """).format(psql.Identifier(self.table_name), psql.Literal(dimension))
                self._client.execute(create_table_sql)

                # Wait for table to be fully ready before creating indexes
                max_wait_seconds = 30
                poll_interval = 2
                for _ in range(max_wait_seconds // poll_interval):
                    if self._client.check_table_exist(self.table_name):
                        break
                    time.sleep(poll_interval)
                else:
                    raise RuntimeError(f"Table {self.table_name} was not ready after {max_wait_seconds}s")

                # Open table and set vector index
                table = self._client.open_table(self.table_name)
                table.set_vector_index(
                    column="embedding",
                    distance_method=self._config.distance_method,
                    base_quantization_type=self._config.base_quantization_type,
                    max_degree=self._config.max_degree,
                    ef_construction=self._config.ef_construction,
                    use_reorder=self._config.base_quantization_type == "rabitq",
                )

                # Create full-text search index
                table.create_text_index(
                    index_name=f"ft_idx_{self._collection_name}",
                    column="text",
                    tokenizer=self._config.tokenizer,
                )

            redis_client.set(collection_exist_cache_key, 1, ex=3600)


class HologresVectorFactory(AbstractVectorFactory):
    """Factory class for creating HologresVector instances."""

    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> HologresVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.HOLOGRES, collection_name))

        return HologresVector(
            collection_name=collection_name,
            config=HologresVectorConfig(
                host=dify_config.HOLOGRES_HOST or "",
                port=dify_config.HOLOGRES_PORT,
                database=dify_config.HOLOGRES_DATABASE or "",
                access_key_id=dify_config.HOLOGRES_ACCESS_KEY_ID or "",
                access_key_secret=dify_config.HOLOGRES_ACCESS_KEY_SECRET or "",
                schema_name=dify_config.HOLOGRES_SCHEMA,
                tokenizer=dify_config.HOLOGRES_TOKENIZER,
                distance_method=dify_config.HOLOGRES_DISTANCE_METHOD,
                base_quantization_type=dify_config.HOLOGRES_BASE_QUANTIZATION_TYPE,
                max_degree=dify_config.HOLOGRES_MAX_DEGREE,
                ef_construction=dify_config.HOLOGRES_EF_CONSTRUCTION,
            ),
        )
