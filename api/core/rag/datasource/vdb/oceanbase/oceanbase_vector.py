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
    enable_hybrid_search: bool = False

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
        self._hybrid_search_enabled = self._check_hybrid_search_support()  # Check if hybrid search is supported

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
            try:
                if self._hybrid_search_enabled:
                    self._client.perform_raw_text_sql(f"""ALTER TABLE {self._collection_name}
                    ADD FULLTEXT INDEX fulltext_index_for_col_text (text) WITH PARSER ik""")
            except Exception as e:
                raise Exception(
                    "Failed to add fulltext index to the target table, your OceanBase version must be 4.3.5.1 or above "
                    + "to support fulltext index and vector index in the same table",
                    e,
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

    def _check_hybrid_search_support(self) -> bool:
        """
        Check if the current OceanBase version supports hybrid search.
        Returns True if the version is >= 4.3.5.1, otherwise False.
        """
        if not self._config.enable_hybrid_search:
            return False

        try:
            from packaging import version

            # return OceanBase_CE 4.3.5.1 (r101000042025031818-bxxxx) (Built Mar 18 2025 18:13:36)
            result = self._client.perform_raw_text_sql("SELECT @@version_comment AS version")
            ob_full_version = result.fetchone()[0]
            ob_version = ob_full_version.split()[1]
            logger.debug("Current OceanBase version is %s", ob_version)
            return version.parse(ob_version).base_version >= version.parse("4.3.5.1").base_version
        except Exception as e:
            logger.warning(f"Failed to check OceanBase version: {str(e)}. Disabling hybrid search.")
            return False

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
        cur = self._client.get(table_name=self._collection_name, ids=id)
        return bool(cur.rowcount != 0)

    def delete_by_ids(self, ids: list[str]) -> None:
        if not ids:
            return
        self._client.delete(table_name=self._collection_name, ids=ids)

    def get_ids_by_metadata_field(self, key: str, value: str) -> list[str]:
        from sqlalchemy import text

        cur = self._client.get(
            table_name=self._collection_name,
            ids=None,
            where_clause=[text(f"metadata->>'$.{key}' = '{value}'")],
            output_column_name=["id"],
        )
        return [row[0] for row in cur]

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        ids = self.get_ids_by_metadata_field(key, value)
        self.delete_by_ids(ids)

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        if not self._hybrid_search_enabled:
            return []

        try:
            top_k = kwargs.get("top_k", 5)
            if not isinstance(top_k, int) or top_k <= 0:
                raise ValueError("top_k must be a positive integer")

            document_ids_filter = kwargs.get("document_ids_filter")
            where_clause = ""
            if document_ids_filter:
                document_ids = ", ".join(f"'{id}'" for id in document_ids_filter)
                where_clause = f" AND metadata->>'$.document_id' IN ({document_ids})"

            full_sql = f"""SELECT metadata, text, MATCH (text) AGAINST (:query) AS score
            FROM {self._collection_name}
            WHERE MATCH (text) AGAINST (:query) > 0
            {where_clause}
            ORDER BY score DESC
            LIMIT {top_k}"""

            with self._client.engine.connect() as conn:
                with conn.begin():
                    from sqlalchemy import text

                    result = conn.execute(text(full_sql), {"query": query})
                    rows = result.fetchall()

                    docs = []
                    for row in rows:
                        metadata_str, _text, score = row
                        try:
                            metadata = json.loads(metadata_str)
                        except json.JSONDecodeError:
                            print(f"Invalid JSON metadata: {metadata_str}")
                            metadata = {}
                        metadata["score"] = score
                        docs.append(Document(page_content=_text, metadata=metadata))

                    return docs
        except Exception as e:
            logger.warning(f"Failed to fulltext search: {str(e)}.")
            return []

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        document_ids_filter = kwargs.get("document_ids_filter")
        _where_clause = None
        if document_ids_filter:
            document_ids = ", ".join(f"'{id}'" for id in document_ids_filter)
            where_clause = f"metadata->>'$.document_id' in ({document_ids})"
            from sqlalchemy import text

            _where_clause = [text(where_clause)]
        ef_search = kwargs.get("ef_search", self._hnsw_ef_search)
        if ef_search != self._hnsw_ef_search:
            self._client.set_ob_hnsw_ef_search(ef_search)
            self._hnsw_ef_search = ef_search
        topk = kwargs.get("top_k", 10)
        try:
            cur = self._client.ann_search(
                table_name=self._collection_name,
                vec_column_name="vector",
                vec_data=query_vector,
                topk=topk,
                distance_func=func.l2_distance,
                output_column_names=["text", "metadata"],
                with_dist=True,
                where_clause=_where_clause,
            )
        except Exception as e:
            raise Exception("Failed to search by vector. ", e)
        docs = []
        for _text, metadata, distance in cur:
            metadata = json.loads(metadata)
            metadata["score"] = 1 - distance / math.sqrt(2)
            docs.append(
                Document(
                    page_content=_text,
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
                enable_hybrid_search=dify_config.OCEANBASE_ENABLE_HYBRID_SEARCH or False,
            ),
        )
