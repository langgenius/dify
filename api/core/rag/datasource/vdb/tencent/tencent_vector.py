import json
import logging
import math
from typing import Any, Optional

from pydantic import BaseModel
from tcvdb_text.encoder import BM25Encoder  # type: ignore
from tcvectordb import RPCVectorDBClient, VectorDBException  # type: ignore
from tcvectordb.model import document, enum  # type: ignore
from tcvectordb.model import index as vdb_index  # type: ignore
from tcvectordb.model.document import AnnSearch, Filter, KeywordSearch, WeightedRerank  # type: ignore

from configs import dify_config
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)


class TencentConfig(BaseModel):
    url: str
    api_key: Optional[str]
    timeout: float = 30
    username: Optional[str]
    database: Optional[str]
    index_type: str = "HNSW"
    metric_type: str = "IP"
    shard: int = 1
    replicas: int = 2
    max_upsert_batch_size: int = 128
    enable_hybrid_search: bool = False  # Flag to enable hybrid search

    def to_tencent_params(self):
        return {"url": self.url, "username": self.username, "key": self.api_key, "timeout": self.timeout}


class TencentVector(BaseVector):
    field_id: str = "id"
    field_vector: str = "vector"
    field_text: str = "text"
    field_metadata: str = "metadata"

    def __init__(self, collection_name: str, config: TencentConfig):
        super().__init__(collection_name)
        self._client_config = config
        self._client = RPCVectorDBClient(**self._client_config.to_tencent_params())
        self._enable_hybrid_search = False
        self._dimension = 1024
        self._init_database()
        self._load_collection()
        self._bm25 = BM25Encoder.default("zh")

    def _load_collection(self):
        """
        Check if the collection supports hybrid search.
        """
        if self._client_config.enable_hybrid_search:
            self._enable_hybrid_search = True
            if self._has_collection():
                coll = self._client.describe_collection(
                    database_name=self._client_config.database, collection_name=self.collection_name
                )
                has_hybrid_search = False
                for idx in coll.indexes:
                    if idx.name == "sparse_vector":
                        has_hybrid_search = True
                    elif idx.name == "vector":
                        self._dimension = idx.dimension
                if not has_hybrid_search:
                    self._enable_hybrid_search = False

    def _init_database(self):
        return self._client.create_database_if_not_exists(database_name=self._client_config.database)

    def get_type(self) -> str:
        return VectorType.TENCENT

    def to_index_struct(self) -> dict:
        return {"type": self.get_type(), "vector_store": {"class_prefix": self._collection_name}}

    def _has_collection(self) -> bool:
        return bool(
            self._client.exists_collection(
                database_name=self._client_config.database, collection_name=self.collection_name
            )
        )

    def _create_collection(self, dimension: int) -> None:
        self._dimension = dimension
        lock_name = "vector_indexing_lock_{}".format(self._collection_name)
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = "vector_indexing_{}".format(self._collection_name)
            if redis_client.get(collection_exist_cache_key):
                return

            if self._has_collection():
                return

            index_type = None
            for k, v in enum.IndexType.__members__.items():
                if k == self._client_config.index_type:
                    index_type = v
            if index_type is None:
                raise ValueError("unsupported index_type")
            metric_type = None
            for k, v in enum.MetricType.__members__.items():
                if k == self._client_config.metric_type:
                    metric_type = v
            if metric_type is None:
                raise ValueError("unsupported metric_type")
            params = vdb_index.HNSWParams(m=16, efconstruction=200)
            index_id = vdb_index.FilterIndex(self.field_id, enum.FieldType.String, enum.IndexType.PRIMARY_KEY)
            index_vector = vdb_index.VectorIndex(
                self.field_vector,
                dimension,
                index_type,
                metric_type,
                params,
            )
            index_metadate = vdb_index.FilterIndex(self.field_metadata, enum.FieldType.Json, enum.IndexType.FILTER)
            index_sparse_vector = vdb_index.SparseIndex(
                name="sparse_vector",
                field_type=enum.FieldType.SparseVector,
                index_type=enum.IndexType.SPARSE_INVERTED,
                metric_type=enum.MetricType.IP,
            )
            indexes = [index_id, index_vector, index_metadate]
            if self._enable_hybrid_search:
                indexes.append(index_sparse_vector)
            try:
                self._client.create_collection(
                    database_name=self._client_config.database,
                    collection_name=self._collection_name,
                    shard=self._client_config.shard,
                    replicas=self._client_config.replicas,
                    description="Collection for Dify",
                    indexes=indexes,
                )
            except VectorDBException as e:
                if "fieldType:json" not in e.message:
                    raise e
                # vdb version not support json, use string
                index_metadate = vdb_index.FilterIndex(
                    self.field_metadata, enum.FieldType.String, enum.IndexType.FILTER
                )
                indexes = [index_id, index_vector, index_metadate]
                if self._enable_hybrid_search:
                    indexes.append(index_sparse_vector)
                self._client.create_collection(
                    database_name=self._client_config.database,
                    collection_name=self._collection_name,
                    shard=self._client_config.shard,
                    replicas=self._client_config.replicas,
                    description="Collection for Dify",
                    indexes=indexes,
                )
            redis_client.set(collection_exist_cache_key, 1, ex=3600)

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        self._create_collection(len(embeddings[0]))
        self.add_texts(texts, embeddings)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        texts = [doc.page_content for doc in documents]
        metadatas = [doc.metadata for doc in documents]
        total_count = len(embeddings)
        batch_size = self._client_config.max_upsert_batch_size
        batch = math.ceil(total_count / batch_size)
        for j in range(batch):
            docs = []
            start_idx = j * batch_size
            end_idx = min(total_count, (j + 1) * batch_size)
            for i in range(start_idx, end_idx):
                if metadatas is None:
                    continue
                metadata = metadatas[i] or {}
                doc = document.Document(
                    id=metadata.get("doc_id"),
                    vector=embeddings[i],
                    text=texts[i],
                    metadata=metadata,
                )
                if self._enable_hybrid_search:
                    doc.__dict__["sparse_vector"] = self._bm25.encode_texts(texts[i])
                docs.append(doc)
            self._client.upsert(
                database_name=self._client_config.database,
                collection_name=self.collection_name,
                documents=docs,
                timeout=self._client_config.timeout,
            )

    def text_exists(self, id: str) -> bool:
        docs = self._client.query(
            database_name=self._client_config.database, collection_name=self.collection_name, document_ids=[id]
        )
        if docs and len(docs) > 0:
            return True
        return False

    def delete_by_ids(self, ids: list[str]) -> None:
        if not ids:
            return
        self._client.delete(
            database_name=self._client_config.database, collection_name=self.collection_name, document_ids=ids
        )

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        self._client.delete(
            database_name=self._client_config.database,
            collection_name=self.collection_name,
            filter=Filter(Filter.In(f"metadata.{key}", [value])),
        )

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        document_ids_filter = kwargs.get("document_ids_filter")
        filter = None
        if document_ids_filter:
            filter = Filter(Filter.In("metadata.document_id", document_ids_filter))
        res = self._client.search(
            database_name=self._client_config.database,
            collection_name=self.collection_name,
            vectors=[query_vector],
            filter=filter,
            params=document.HNSWSearchParams(ef=kwargs.get("ef", 10)),
            retrieve_vector=False,
            limit=kwargs.get("top_k", 4),
            timeout=self._client_config.timeout,
        )
        score_threshold = float(kwargs.get("score_threshold") or 0.0)
        return self._get_search_res(res, score_threshold)

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        if not self._enable_hybrid_search:
            return []
        res = self._client.hybrid_search(
            database_name=self._client_config.database,
            collection_name=self.collection_name,
            ann=[
                AnnSearch(
                    field_name="vector",
                    data=[0.0] * self._dimension,
                )
            ],
            match=[
                KeywordSearch(
                    field_name="sparse_vector",
                    data=self._bm25.encode_queries(query),
                ),
            ],
            rerank=WeightedRerank(
                field_list=["vector", "sparse_vector"],
                weight=[0, 1],
            ),
            retrieve_vector=False,
            limit=kwargs.get("top_k", 4),
        )
        score_threshold = float(kwargs.get("score_threshold") or 0.0)
        return self._get_search_res(res, score_threshold)

    def _get_search_res(self, res: list | None, score_threshold: float) -> list[Document]:
        docs: list[Document] = []
        if res is None or len(res) == 0:
            return docs

        for result in res[0]:
            meta = result.get(self.field_metadata)
            if isinstance(meta, str):
                # Compatible with version 1.1.3 and below.
                meta = json.loads(meta)
                score = 1 - result.get("score", 0.0)
            score = result.get("score", 0.0)
            if score > score_threshold:
                meta["score"] = score
                doc = Document(page_content=result.get(self.field_text), metadata=meta)
                docs.append(doc)
        return docs

    def delete(self) -> None:
        if self._has_collection():
            self._client.drop_collection(
                database_name=self._client_config.database, collection_name=self.collection_name
            )


class TencentVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> TencentVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix.lower()
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id).lower()
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.TENCENT, collection_name))

        return TencentVector(
            collection_name=collection_name,
            config=TencentConfig(
                url=dify_config.TENCENT_VECTOR_DB_URL or "",
                api_key=dify_config.TENCENT_VECTOR_DB_API_KEY,
                timeout=dify_config.TENCENT_VECTOR_DB_TIMEOUT,
                username=dify_config.TENCENT_VECTOR_DB_USERNAME,
                database=dify_config.TENCENT_VECTOR_DB_DATABASE,
                shard=dify_config.TENCENT_VECTOR_DB_SHARD,
                replicas=dify_config.TENCENT_VECTOR_DB_REPLICAS,
                enable_hybrid_search=dify_config.TENCENT_VECTOR_DB_ENABLE_HYBRID_SEARCH or False,
            ),
        )
