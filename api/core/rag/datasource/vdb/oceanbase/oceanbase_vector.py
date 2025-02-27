import json
import logging
import math
from typing import Any

from pydantic import BaseModel, model_validator
from pyobvector import VECTOR, ObVecClient  # type: ignore
from sqlalchemy import JSON, Column, String, func
from sqlalchemy.dialects.mysql import LONGTEXT

from configs import dify_config
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)

DEFAULT_OCEANBASE_HNSW_BUILD_PARAM = {"M": 16, "efConstruction": 256}
DEFAULT_OCEANBASE_HNSW_SEARCH_PARAM = {"efSearch": 64}
OCEANBASE_SUPPORTED_VECTOR_INDEX_TYPE = "HNSW"
DEFAULT_OCEANBASE_VECTOR_METRIC_TYPE = "l2"


class OceanBaseVectorConfig(BaseModel):
    host: str
    port: int
    user: str
    password: str
    database: str

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict) -> dict:
        if not values["host"]:
            raise ValueError("config OCEANBASE_VECTOR_HOST is required")
        if not values["port"]:
            raise ValueError("config OCEANBASE_VECTOR_PORT is required")
        if not values["user"]:
            raise ValueError("config OCEANBASE_VECTOR_USER is required")
        if not values["database"]:
            raise ValueError("config OCEANBASE_VECTOR_DATABASE is required")
        return values


class OceanBaseVector(BaseVector):
    def __init__(self, collection_name: str, config: OceanBaseVectorConfig):
        super().__init__(collection_name)
        self._config = config
        self._hnsw_ef_search = -1
        self._client = ObVecClient(
            uri=f"{self._config.host}:{self._config.port}",
            user=self._config.user,
            password=self._config.password,
            db_name=self._config.database,
        )

    def get_type(self) -> str:
        return VectorType.OCEANBASE

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        self._vec_dim = len(embeddings[0])
        self._create_collection()
        self.add_texts(texts, embeddings)

    def _create_collection(self) -> None:
        lock_name = "vector_indexing_lock_" + self._collection_name
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = "vector_indexing_" + self._collection_name
            if redis_client.get(collection_exist_cache_key):
                return

            if self._client.check_table_exists(self._collection_name):
                return

            self.delete()

            cols = [
                Column("id", String(36), primary_key=True, autoincrement=False),
                Column("vector", VECTOR(self._vec_dim)),
                Column("text", LONGTEXT),
                Column("metadata", JSON),
            ]
            vidx_params = self._client.prepare_index_params()
            vidx_params.add_index(
                field_name="vector",
                index_type=OCEANBASE_SUPPORTED_VECTOR_INDEX_TYPE,
                index_name="vector_index",
                metric_type=DEFAULT_OCEANBASE_VECTOR_METRIC_TYPE,
                params=DEFAULT_OCEANBASE_HNSW_BUILD_PARAM,
            )

            self._client.create_table_with_index_params(
                table_name=self._collection_name,
                columns=cols,
                vidxs=vidx_params,
            )
            vals = []
            params = self._client.perform_raw_text_sql("SHOW PARAMETERS LIKE '%ob_vector_memory_limit_percentage%'")
            for row in params:
                val = int(row[6])
                vals.append(val)
            if len(vals) == 0:
                raise ValueError("ob_vector_memory_limit_percentage not found in parameters.")
            if any(val == 0 for val in vals):
                try:
                    self._client.perform_raw_text_sql("ALTER SYSTEM SET ob_vector_memory_limit_percentage = 30")
                except Exception as e:
                    raise Exception(
                        "Failed to set ob_vector_memory_limit_percentage. "
                        + "Maybe the database user has insufficient privilege.",
                        e,
                    )
            redis_client.set(collection_exist_cache_key, 1, ex=3600)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        ids = self._get_uuids(documents)
        for id, doc, emb in zip(ids, documents, embeddings):
            self._client.insert(
                table_name=self._collection_name,
                data={
                    "id": id,
                    "vector": emb,
                    "text": doc.page_content,
                    "metadata": doc.metadata,
                },
            )

    def text_exists(self, id: str) -> bool:
        cur = self._client.get(table_name=self._collection_name, id=id)
        return bool(cur.rowcount != 0)

    def delete_by_ids(self, ids: list[str]) -> None:
        if not ids:
            return
        self._client.delete(table_name=self._collection_name, ids=ids)

    def get_ids_by_metadata_field(self, key: str, value: str) -> list[str]:
        cur = self._client.get(
            table_name=self._collection_name,
            where_clause=f"metadata->>'$.{key}' = '{value}'",
            output_column_name=["id"],
        )
        return [row[0] for row in cur]

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        ids = self.get_ids_by_metadata_field(key, value)
        self.delete_by_ids(ids)

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        return []

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        document_ids_filter = kwargs.get("document_ids_filter")
        where_clause = None
        if document_ids_filter:
            document_ids = ", ".join(f"'{id}'" for id in document_ids_filter)
            where_clause = f"metadata->>'$.document_id' in ({document_ids})"
        ef_search = kwargs.get("ef_search", self._hnsw_ef_search)
        if ef_search != self._hnsw_ef_search:
            self._client.set_ob_hnsw_ef_search(ef_search)
            self._hnsw_ef_search = ef_search
        topk = kwargs.get("top_k", 10)
        cur = self._client.ann_search(
            table_name=self._collection_name,
            vec_column_name="vector",
            vec_data=query_vector,
            topk=topk,
            distance_func=func.l2_distance,
            output_column_names=["text", "metadata"],
            with_dist=True,
            where_clause=where_clause,
        )
        docs = []
        for text, metadata, distance in cur:
            metadata = json.loads(metadata)
            metadata["score"] = 1 - distance / math.sqrt(2)
            docs.append(
                Document(
                    page_content=text,
                    metadata=metadata,
                )
            )
        return docs

    def delete(self) -> None:
        self._client.drop_table_if_exist(self._collection_name)


class OceanBaseVectorFactory(AbstractVectorFactory):
    def init_vector(
        self,
        dataset: Dataset,
        attributes: list,
        embeddings: Embeddings,
    ) -> BaseVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix.lower()
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id).lower()
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.OCEANBASE, collection_name))
        return OceanBaseVector(
            collection_name,
            OceanBaseVectorConfig(
                host=dify_config.OCEANBASE_VECTOR_HOST or "",
                port=dify_config.OCEANBASE_VECTOR_PORT or 0,
                user=dify_config.OCEANBASE_VECTOR_USER or "",
                password=(dify_config.OCEANBASE_VECTOR_PASSWORD or ""),
                database=dify_config.OCEANBASE_VECTOR_DATABASE or "",
            ),
        )
