import json
import logging
import time
import uuid
from typing import Any

import numpy as np
from pydantic import BaseModel, model_validator
from pymochow import MochowClient  # type: ignore
from pymochow.auth.bce_credentials import BceCredentials  # type: ignore
from pymochow.configuration import Configuration  # type: ignore
from pymochow.exception import ServerError  # type: ignore
from pymochow.model.database import Database
from pymochow.model.enum import FieldType, IndexState, IndexType, MetricType, ServerErrCode, TableState  # type: ignore
from pymochow.model.schema import (
    Field,
    FilteringIndex,
    HNSWParams,
    InvertedIndex,
    InvertedIndexAnalyzer,
    InvertedIndexFieldAttribute,
    InvertedIndexParams,
    InvertedIndexParseMode,
    Schema,
    VectorIndex,
)  # type: ignore
from pymochow.model.table import AnnSearch, BM25SearchRequest, HNSWSearchParams, Partition, Row  # type: ignore

from configs import dify_config
from core.rag.datasource.vdb.field import Field as VDBField
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)


class BaiduConfig(BaseModel):
    endpoint: str
    connection_timeout_in_mills: int = 30 * 1000
    account: str
    api_key: str
    database: str
    index_type: str = "HNSW"
    metric_type: str = "IP"
    shard: int = 1
    replicas: int = 3
    inverted_index_analyzer: str = "DEFAULT_ANALYZER"
    inverted_index_parser_mode: str = "COARSE_MODE"

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict):
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
    vector_index: str = "vector_idx"
    filtering_index: str = "filtering_idx"
    inverted_index: str = "content_inverted_idx"

    def __init__(self, collection_name: str, config: BaiduConfig):
        super().__init__(collection_name)
        self._client_config = config
        self._client = self._init_client(config)
        self._db = self._init_database()

    def get_type(self) -> str:
        return VectorType.BAIDU

    def to_index_struct(self):
        return {"type": self.get_type(), "vector_store": {"class_prefix": self._collection_name}}

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        self._create_table(len(embeddings[0]))
        self.add_texts(texts, embeddings)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        total_count = len(documents)
        batch_size = 1000

        # upsert texts and embeddings batch by batch
        table = self._db.table(self._collection_name)
        for start in range(0, total_count, batch_size):
            end = min(start + batch_size, total_count)
            rows = []
            for i in range(start, end, 1):
                metadata = documents[i].metadata
                row = Row(
                    id=metadata.get("doc_id", str(uuid.uuid4())),
                    page_content=documents[i].page_content,
                    metadata=metadata,
                    vector=embeddings[i],
                )
                rows.append(row)
            table.upsert(rows=rows)

        # rebuild vector index after upsert finished
        table.rebuild_index(self.vector_index)
        timeout = 3600  # 1 hour timeout
        start_time = time.time()
        while True:
            time.sleep(1)
            index = table.describe_index(self.vector_index)
            if index.state == IndexState.NORMAL:
                break
            if time.time() - start_time > timeout:
                raise TimeoutError(f"Index rebuild timeout after {timeout} seconds")

    def text_exists(self, id: str) -> bool:
        res = self._db.table(self._collection_name).query(primary_key={VDBField.PRIMARY_KEY: id})
        if res and res.code == 0:
            return True
        return False

    def delete_by_ids(self, ids: list[str]):
        if not ids:
            return
        quoted_ids = [f"'{id}'" for id in ids]
        self._db.table(self._collection_name).delete(filter=f"{VDBField.PRIMARY_KEY} IN({', '.join(quoted_ids)})")

    def delete_by_metadata_field(self, key: str, value: str):
        # Escape double quotes in value to prevent injection
        escaped_value = value.replace('"', '\\"')
        self._db.table(self._collection_name).delete(filter=f'metadata["{key}"] = "{escaped_value}"')

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        query_vector = [float(val) if isinstance(val, np.float64) else val for val in query_vector]
        document_ids_filter = kwargs.get("document_ids_filter")
        filter = ""
        if document_ids_filter:
            document_ids = ", ".join(f"'{id}'" for id in document_ids_filter)
            filter = f'metadata["document_id"] IN({document_ids})'
        anns = AnnSearch(
            vector_field=VDBField.VECTOR,
            vector_floats=query_vector,
            params=HNSWSearchParams(ef=kwargs.get("ef", 20), limit=kwargs.get("top_k", 4)),
            filter=filter,
        )
        res = self._db.table(self._collection_name).search(
            anns=anns,
            projections=[VDBField.CONTENT_KEY, VDBField.METADATA_KEY],
            retrieve_vector=False,
        )
        score_threshold = float(kwargs.get("score_threshold") or 0.0)
        return self._get_search_res(res, score_threshold)

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        # document ids filter
        document_ids_filter = kwargs.get("document_ids_filter")
        filter = ""
        if document_ids_filter:
            document_ids = ", ".join(f"'{id}'" for id in document_ids_filter)
            filter = f'metadata["document_id"] IN({document_ids})'

        request = BM25SearchRequest(
            index_name=self.inverted_index, search_text=query, limit=kwargs.get("top_k", 4), filter=filter
        )
        res = self._db.table(self._collection_name).bm25_search(
            request=request, projections=[VDBField.CONTENT_KEY, VDBField.METADATA_KEY]
        )
        score_threshold = float(kwargs.get("score_threshold") or 0.0)
        return self._get_search_res(res, score_threshold)

    def _get_search_res(self, res, score_threshold) -> list[Document]:
        docs = []
        for row in res.rows:
            row_data = row.get("row", {})
            score = row.get("score", 0.0)
            meta = row_data.get(VDBField.METADATA_KEY, {})

            # Handle both JSON string and dict formats for backward compatibility
            if isinstance(meta, str):
                try:
                    import json

                    meta = json.loads(meta)
                except (json.JSONDecodeError, TypeError):
                    meta = {}
            elif not isinstance(meta, dict):
                meta = {}

            if score >= score_threshold:
                meta["score"] = score
                doc = Document(page_content=row_data.get(VDBField.CONTENT_KEY), metadata=meta)
                docs.append(doc)
        return docs

    def delete(self):
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

    def _init_database(self) -> Database:
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
                    return self._client.database(self._client_config.database)
                else:
                    raise
            return self._client.database(self._client_config.database)

    def _table_existed(self) -> bool:
        tables = self._db.list_table()
        return any(table.table_name == self._collection_name for table in tables)

    def _create_table(self, dimension: int):
        # Try to grab distributed lock and create table
        lock_name = f"vector_indexing_lock_{self._collection_name}"
        with redis_client.lock(lock_name, timeout=60):
            table_exist_cache_key = f"vector_indexing_{self._collection_name}"
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
                    VDBField.PRIMARY_KEY,
                    FieldType.STRING,
                    primary_key=True,
                    partition_key=True,
                    auto_increment=False,
                    not_null=True,
                )
            )
            fields.append(Field(VDBField.CONTENT_KEY, FieldType.TEXT, not_null=False))
            fields.append(Field(VDBField.METADATA_KEY, FieldType.JSON, not_null=False))
            fields.append(Field(VDBField.VECTOR, FieldType.FLOAT_VECTOR, not_null=True, dimension=dimension))

            # Construct vector index params
            indexes = []
            indexes.append(
                VectorIndex(
                    index_name=self.vector_index,
                    index_type=index_type,
                    field=VDBField.VECTOR,
                    metric_type=metric_type,
                    params=HNSWParams(m=16, efconstruction=200),
                )
            )

            # Filtering index
            indexes.append(
                FilteringIndex(
                    index_name=self.filtering_index,
                    fields=[VDBField.METADATA_KEY],
                )
            )

            # Get analyzer and parse_mode from config
            analyzer = getattr(
                InvertedIndexAnalyzer,
                self._client_config.inverted_index_analyzer,
                InvertedIndexAnalyzer.DEFAULT_ANALYZER,
            )

            parse_mode = getattr(
                InvertedIndexParseMode,
                self._client_config.inverted_index_parser_mode,
                InvertedIndexParseMode.COARSE_MODE,
            )

            # Inverted index
            indexes.append(
                InvertedIndex(
                    index_name=self.inverted_index,
                    fields=[VDBField.CONTENT_KEY],
                    params=InvertedIndexParams(
                        analyzer=analyzer,
                        parse_mode=parse_mode,
                        case_sensitive=True,
                    ),
                    field_attributes=[InvertedIndexFieldAttribute.ANALYZED],
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
            timeout = 300  # 5 minutes timeout
            start_time = time.time()
            while True:
                time.sleep(1)
                table = self._db.describe_table(self._collection_name)
                if table.state == TableState.NORMAL:
                    break
                if time.time() - start_time > timeout:
                    raise TimeoutError(f"Table creation timeout after {timeout} seconds")
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
                inverted_index_analyzer=dify_config.BAIDU_VECTOR_DB_INVERTED_INDEX_ANALYZER,
                inverted_index_parser_mode=dify_config.BAIDU_VECTOR_DB_INVERTED_INDEX_PARSER_MODE,
            ),
        )
