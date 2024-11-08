import json
import logging
import uuid
from enum import Enum
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


class MyScaleConfig(BaseModel):
    host: str
    port: int
    user: str
    password: str
    database: str
    fts_params: str


class SortOrder(Enum):
    ASC = "ASC"
    DESC = "DESC"


class MyScaleVector(BaseVector):
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

    def get_type(self) -> str:
        return VectorType.MYSCALE

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        dimension = len(embeddings[0])
        self._create_collection(dimension)
        return self.add_texts(documents=texts, embeddings=embeddings, **kwargs)

    def _create_collection(self, dimension: int):
        logging.info(f"create MyScale collection {self._collection_name} with dimension {dimension}")
        self._client.command(f"CREATE DATABASE IF NOT EXISTS {self._config.database}")
        fts_params = f"('{self._config.fts_params}')" if self._config.fts_params else ""
        sql = f"""
            CREATE TABLE IF NOT EXISTS {self._config.database}.{self._collection_name}(
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
        values = []
        for i, doc in enumerate(documents):
            doc_id = doc.metadata.get("doc_id", str(uuid.uuid4()))
            row = (
                doc_id,
                self.escape_str(doc.page_content),
                embeddings[i],
                json.dumps(doc.metadata) if doc.metadata else {},
            )
            values.append(str(row))
            ids.append(doc_id)
        sql = f"""
            INSERT INTO {self._config.database}.{self._collection_name}
            ({",".join(columns)}) VALUES {",".join(values)}
        """
        self._client.command(sql)
        return ids

    @staticmethod
    def escape_str(value: Any) -> str:
        return "".join(" " if c in {"\\", "'"} else c for c in str(value))

    def text_exists(self, id: str) -> bool:
        results = self._client.query(f"SELECT id FROM {self._config.database}.{self._collection_name} WHERE id='{id}'")
        return results.row_count > 0

    def delete_by_ids(self, ids: list[str]) -> None:
        self._client.command(
            f"DELETE FROM {self._config.database}.{self._collection_name} WHERE id IN {str(tuple(ids))}"
        )

    def get_ids_by_metadata_field(self, key: str, value: str):
        rows = self._client.query(
            f"SELECT DISTINCT id FROM {self._config.database}.{self._collection_name} WHERE metadata.{key}='{value}'"
        ).result_rows
        return [row[0] for row in rows]

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        self._client.command(
            f"DELETE FROM {self._config.database}.{self._collection_name} WHERE metadata.{key}='{value}'"
        )

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        return self._search(f"distance(vector, {str(query_vector)})", self._vec_order, **kwargs)

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        return self._search(f"TextSearch('enable_nlq=false')(text, '{query}')", SortOrder.DESC, **kwargs)

    def _search(self, dist: str, order: SortOrder, **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 4)
        score_threshold = float(kwargs.get("score_threshold") or 0.0)
        where_str = (
            f"WHERE dist < {1 - score_threshold}"
            if self._metric.upper() == "COSINE" and order == SortOrder.ASC and score_threshold > 0.0
            else ""
        )
        sql = f"""
            SELECT text, vector, metadata, {dist} as dist FROM {self._config.database}.{self._collection_name}
            {where_str} ORDER BY dist {order.value} LIMIT {top_k}
        """
        try:
            return [
                Document(
                    page_content=r["text"],
                    vector=r["vector"],
                    metadata=r["metadata"],
                )
                for r in self._client.query(sql).named_results()
            ]
        except Exception as e:
            logging.exception(f"\033[91m\033[1m{type(e)}\033[0m \033[95m{str(e)}\033[0m")
            return []

    def delete(self) -> None:
        self._client.command(f"DROP TABLE IF EXISTS {self._config.database}.{self._collection_name}")


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
