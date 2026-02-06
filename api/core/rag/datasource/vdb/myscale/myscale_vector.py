import json
import logging
import uuid
from enum import StrEnum
from typing import Any

from clickhouse_connect import get_client
from pydantic import BaseModel

from configs import dify_config
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from models.dataset import Dataset

logger = logging.getLogger(__name__)


class MyScaleConfig(BaseModel):
    host: str
    port: int
    user: str
    password: str
    database: str
    fts_params: str


class SortOrder(StrEnum):
    ASC = "ASC"
    DESC = "DESC"


class MyScaleVector(BaseVector):
    _METADATA_KEY_WHITELIST = {
        "annotation_id",
        "app_id",
        "batch",
        "dataset_id",
        "doc_hash",
        "doc_id",
        "document_id",
        "lang",
        "source",
    }

    def __init__(self, collection_name: str, config: MyScaleConfig, metric: str = "Cosine"):
        super().__init__(collection_name)
        self._config = config
        self._metric = metric
        self._vec_order = SortOrder.ASC if metric.upper() in {"COSINE", "L2"} else SortOrder.DESC
        self._client = get_client(
            host=config.host,
            port=config.port,
            username=config.user,
            password=config.password,
        )
        self._client.command("SET allow_experimental_object_type=1")
        self._qualified_table = f"{self._config.database}.{self._collection_name}"

    def get_type(self) -> str:
        return VectorType.MYSCALE

    @classmethod
    def _validate_metadata_key(cls, key: str) -> str:
        if key not in cls._METADATA_KEY_WHITELIST:
            raise ValueError(f"Unsupported metadata key: {key!r}")
        return key

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        dimension = len(embeddings[0])
        self._create_collection(dimension)
        return self.add_texts(documents=texts, embeddings=embeddings, **kwargs)

    def _create_collection(self, dimension: int):
        logger.info("create MyScale collection %s with dimension %s", self._collection_name, dimension)
        self._client.command(f"CREATE DATABASE IF NOT EXISTS {self._config.database}")
        fts_params = f"('{self._config.fts_params}')" if self._config.fts_params else ""
        sql = f"""
            CREATE TABLE IF NOT EXISTS {self._qualified_table}(
                id String,
                text String,
                vector Array(Float32),
                metadata JSON,
                CONSTRAINT cons_vec_len CHECK length(vector) = {dimension},
                VECTOR INDEX vidx vector TYPE DEFAULT('metric_type = {self._metric}'),
                INDEX text_idx text TYPE fts{fts_params}
            ) ENGINE = MergeTree ORDER BY id
        """
        self._client.command(sql)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        ids = []
        columns = ["id", "text", "vector", "metadata"]
        rows = []
        for i, doc in enumerate(documents):
            if doc.metadata is not None:
                doc_id = doc.metadata.get("doc_id", str(uuid.uuid4()))
                rows.append(
                    (
                        doc_id,
                        self.escape_str(doc.page_content),
                        embeddings[i],
                        json.dumps(doc.metadata or {}),
                    )
                )
                ids.append(doc_id)
        if rows:
            self._client.insert(self._qualified_table, rows, column_names=columns)
        return ids

    @staticmethod
    def escape_str(value: Any) -> str:
        return "".join(" " if c in {"\\", "'"} else c for c in str(value))

    def text_exists(self, id: str) -> bool:
        results = self._client.query(
            f"SELECT id FROM {self._qualified_table} WHERE id = %(id)s LIMIT 1",
            parameters={"id": id},
        )
        return results.row_count > 0

    def delete_by_ids(self, ids: list[str]):
        if not ids:
            return
        placeholders, params = self._build_in_params("id", ids)
        self._client.command(
            f"DELETE FROM {self._qualified_table} WHERE id IN ({placeholders})",
            parameters=params,
        )

    def get_ids_by_metadata_field(self, key: str, value: str):
        safe_key = self._validate_metadata_key(key)
        rows = self._client.query(
            f"SELECT DISTINCT id FROM {self._qualified_table} WHERE metadata.{safe_key} = %(value)s",
            parameters={"value": value},
        ).result_rows
        return [row[0] for row in rows]

    def delete_by_metadata_field(self, key: str, value: str):
        safe_key = self._validate_metadata_key(key)
        self._client.command(
            f"DELETE FROM {self._qualified_table} WHERE metadata.{safe_key} = %(value)s",
            parameters={"value": value},
        )

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        return self._search(f"distance(vector, {str(query_vector)})", self._vec_order, **kwargs)

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        return self._search(
            "TextSearch('enable_nlq=false')(text, %(query)s)",
            SortOrder.DESC,
            parameters={"query": query},
            **kwargs,
        )

    @staticmethod
    def _build_in_params(prefix: str, values: list[str]) -> tuple[str, dict[str, str]]:
        params: dict[str, str] = {}
        placeholders = []
        for i, value in enumerate(values):
            name = f"{prefix}_{i}"
            placeholders.append(f"%({name})s")
            params[name] = value
        return ", ".join(placeholders), params

    def _search(
        self,
        dist: str,
        order: SortOrder,
        parameters: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> list[Document]:
        top_k = kwargs.get("top_k", 4)
        if not isinstance(top_k, int) or top_k <= 0:
            raise ValueError("top_k must be a positive integer")
        score_threshold = float(kwargs.get("score_threshold") or 0.0)
        where_clauses = []
        if self._metric.upper() == "COSINE" and order == SortOrder.ASC and score_threshold > 0.0:
            where_clauses.append(f"dist < {1 - score_threshold}")
        document_ids_filter = kwargs.get("document_ids_filter")
        query_params = dict(parameters or {})
        if document_ids_filter:
            placeholders, params = self._build_in_params("document_id", document_ids_filter)
            where_clauses.append(f"metadata['document_id'] IN ({placeholders})")
            query_params.update(params)
        where_str = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        sql = f"""
            SELECT text, vector, metadata, {dist} as dist FROM {self._qualified_table}
            {where_str} ORDER BY dist {order.value} LIMIT {top_k}
        """
        try:
            return [
                Document(
                    page_content=r["text"],
                    vector=r["vector"],
                    metadata=r["metadata"],
                )
                for r in self._client.query(sql, parameters=query_params).named_results()
            ]
        except Exception:
            logger.exception("Vector search operation failed")
            return []

    def delete(self):
        self._client.command(f"DROP TABLE IF EXISTS {self._qualified_table}")


class MyScaleVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> MyScaleVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix.lower()
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id).lower()
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.MYSCALE, collection_name))

        return MyScaleVector(
            collection_name=collection_name,
            config=MyScaleConfig(
                host=dify_config.MYSCALE_HOST,
                port=dify_config.MYSCALE_PORT,
                user=dify_config.MYSCALE_USER,
                password=dify_config.MYSCALE_PASSWORD,
                database=dify_config.MYSCALE_DATABASE,
                fts_params=dify_config.MYSCALE_FTS_PARAMS,
            ),
        )
