import json
import time
import uuid
from typing import Any

import numpy as np
from pydantic import BaseModel, model_validator
from pymochow import MochowClient  # type: ignore
from pymochow.auth.bce_credentials import BceCredentials  # type: ignore
from pymochow.configuration import Configuration  # type: ignore
from pymochow.exception import ServerError  # type: ignore
from pymochow.model.enum import FieldType, IndexState, IndexType, MetricType, ServerErrCode, TableState  # type: ignore
from pymochow.model.schema import Field, HNSWParams, Schema, VectorIndex  # type: ignore
from pymochow.model.table import AnnSearch, HNSWSearchParams, Partition, Row  # type: ignore

from configs import dify_config
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset


class BaiduConfig(BaseModel):
    endpoint: str
    connection_timeout_in_mills: int = 30 * 1000
    account: str
    api_key: str
    database: str
    index_type: str = "HNSW"
    metric_type: str = "L2"
    shard: int = 1
    replicas: int = 3

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict) -> dict:
        if not values["endpoint"]:
            raise ValueError("config BAIDU_VECTOR_DB_ENDPOINT is required")
        if not values["account"]:
            raise ValueError("config BAIDU_VECTOR_DB_ACCOUNT is required")
        if not values["api_key"]:
            raise ValueError("config BAIDU_VECTOR_DB_API_KEY is required")
        if not values["database"]:
            raise ValueError("config BAIDU_VECTOR_DB_DATABASE is required")
        return values


class BaiduVector(BaseVector):
    field_id: str = "id"
    field_vector: str = "vector"
    field_text: str = "text"
    field_metadata: str = "metadata"
    field_app_id: str = "app_id"
    field_annotation_id: str = "annotation_id"
    index_vector: str = "vector_idx"

    def __init__(self, collection_name: str, config: BaiduConfig):
        super().__init__(collection_name)
        self._client_config = config
        self._client = self._init_client(config)
        self._db = self._init_database()

    def get_type(self) -> str:
        return VectorType.BAIDU

    def to_index_struct(self) -> dict:
        return {"type": self.get_type(), "vector_store": {"class_prefix": self._collection_name}}

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        self._create_table(len(embeddings[0]))
        self.add_texts(texts, embeddings)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        texts = [doc.page_content for doc in documents]
        metadatas = [doc.metadata for doc in documents if doc.metadata is not None]
        total_count = len(documents)
        batch_size = 1000

        # upsert texts and embeddings batch by batch
        table = self._db.table(self._collection_name)
        for start in range(0, total_count, batch_size):
            end = min(start + batch_size, total_count)
            rows = []
            assert len(metadatas) == total_count, "metadatas length should be equal to total_count"
            # FIXME do you need this assert?
            for i in range(start, end, 1):
                row = Row(
                    id=metadatas[i].get("doc_id", str(uuid.uuid4())),
                    vector=embeddings[i],
                    text=texts[i],
                    metadata=json.dumps(metadatas[i]),
                    app_id=metadatas[i].get("app_id", ""),
                    annotation_id=metadatas[i].get("annotation_id", ""),
                )
                rows.append(row)
            table.upsert(rows=rows)

        # rebuild vector index after upsert finished
        table.rebuild_index(self.index_vector)
        while True:
            time.sleep(1)
            index = table.describe_index(self.index_vector)
            if index.state == IndexState.NORMAL:
                break

    def text_exists(self, id: str) -> bool:
        res = self._db.table(self._collection_name).query(primary_key={self.field_id: id})
        if res and res.code == 0:
            return True
        return False

    def delete_by_ids(self, ids: list[str]) -> None:
        if not ids:
            return
        quoted_ids = [f"'{id}'" for id in ids]
        self._db.table(self._collection_name).delete(filter=f"id IN({', '.join(quoted_ids)})")

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        self._db.table(self._collection_name).delete(filter=f"{key} = '{value}'")

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        query_vector = [float(val) if isinstance(val, np.float64) else val for val in query_vector]
        anns = AnnSearch(
            vector_field=self.field_vector,
            vector_floats=query_vector,
            params=HNSWSearchParams(ef=kwargs.get("ef", 10), limit=kwargs.get("top_k", 4)),
        )
        res = self._db.table(self._collection_name).search(
            anns=anns,
            projections=[self.field_id, self.field_text, self.field_metadata],
            retrieve_vector=True,
        )
        score_threshold = float(kwargs.get("score_threshold") or 0.0)
        return self._get_search_res(res, score_threshold)

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        # baidu vector database doesn't support bm25 search on current version
        return []

    def _get_search_res(self, res, score_threshold) -> list[Document]:
        docs = []
        for row in res.rows:
            row_data = row.get("row", {})
            meta = row_data.get(self.field_metadata)
            if meta is not None:
                meta = json.loads(meta)
            score = row.get("score", 0.0)
            if score > score_threshold:
                meta["score"] = score
                doc = Document(page_content=row_data.get(self.field_text), metadata=meta)
                docs.append(doc)

        return docs

    def delete(self) -> None:
        try:
            self._db.drop_table(table_name=self._collection_name)
        except ServerError as e:
            if e.code == ServerErrCode.TABLE_NOT_EXIST:
                pass
            else:
                raise

    def _init_client(self, config) -> MochowClient:
        config = Configuration(credentials=BceCredentials(config.account, config.api_key), endpoint=config.endpoint)
        client = MochowClient(config)
        return client

    def _init_database(self):
        exists = False
        for db in self._client.list_databases():
            if db.database_name == self._client_config.database:
                exists = True
                break
        # Create database if not existed
        if exists:
            return self._client.database(self._client_config.database)
        else:
            try:
                self._client.create_database(database_name=self._client_config.database)
            except ServerError as e:
                if e.code == ServerErrCode.DB_ALREADY_EXIST:
                    pass
                else:
                    raise
            return

    def _table_existed(self) -> bool:
        tables = self._db.list_table()
        return any(table.table_name == self._collection_name for table in tables)

    def _create_table(self, dimension: int) -> None:
        # Try to grab distributed lock and create table
        lock_name = "vector_indexing_lock_{}".format(self._collection_name)
        with redis_client.lock(lock_name, timeout=60):
            table_exist_cache_key = "vector_indexing_{}".format(self._collection_name)
            if redis_client.get(table_exist_cache_key):
                return

            if self._table_existed():
                return

            self.delete()

            # check IndexType and MetricType
            index_type = None
            for k, v in IndexType.__members__.items():
                if k == self._client_config.index_type:
                    index_type = v
            if index_type is None:
                raise ValueError("unsupported index_type")
            metric_type = None
            for k, v in MetricType.__members__.items():
                if k == self._client_config.metric_type:
                    metric_type = v
            if metric_type is None:
                raise ValueError("unsupported metric_type")

            # Construct field schema
            fields = []
            fields.append(
                Field(
                    self.field_id,
                    FieldType.STRING,
                    primary_key=True,
                    partition_key=True,
                    auto_increment=False,
                    not_null=True,
                )
            )
            fields.append(Field(self.field_metadata, FieldType.STRING, not_null=True))
            fields.append(Field(self.field_app_id, FieldType.STRING))
            fields.append(Field(self.field_annotation_id, FieldType.STRING))
            fields.append(Field(self.field_text, FieldType.TEXT, not_null=True))
            fields.append(Field(self.field_vector, FieldType.FLOAT_VECTOR, not_null=True, dimension=dimension))

            # Construct vector index params
            indexes = []
            indexes.append(
                VectorIndex(
                    index_name="vector_idx",
                    index_type=index_type,
                    field="vector",
                    metric_type=metric_type,
                    params=HNSWParams(m=16, efconstruction=200),
                )
            )

            # Create table
            self._db.create_table(
                table_name=self._collection_name,
                replication=self._client_config.replicas,
                partition=Partition(partition_num=self._client_config.shard),
                schema=Schema(fields=fields, indexes=indexes),
                description="Table for Dify",
            )

            # Wait for table created
            while True:
                time.sleep(1)
                table = self._db.describe_table(self._collection_name)
                if table.state == TableState.NORMAL:
                    break
            redis_client.set(table_exist_cache_key, 1, ex=3600)


class BaiduVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> BaiduVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix.lower()
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id).lower()
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.BAIDU, collection_name))

        return BaiduVector(
            collection_name=collection_name,
            config=BaiduConfig(
                endpoint=dify_config.BAIDU_VECTOR_DB_ENDPOINT or "",
                connection_timeout_in_mills=dify_config.BAIDU_VECTOR_DB_CONNECTION_TIMEOUT_MS,
                account=dify_config.BAIDU_VECTOR_DB_ACCOUNT or "",
                api_key=dify_config.BAIDU_VECTOR_DB_API_KEY or "",
                database=dify_config.BAIDU_VECTOR_DB_DATABASE or "",
                shard=dify_config.BAIDU_VECTOR_DB_SHARD,
                replicas=dify_config.BAIDU_VECTOR_DB_REPLICAS,
            ),
        )
