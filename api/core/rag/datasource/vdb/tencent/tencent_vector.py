import json
from typing import Any, Optional

from pydantic import BaseModel
from tcvectordb import VectorDBClient
from tcvectordb.model import document, enum
from tcvectordb.model import index as vdb_index
from tcvectordb.model.document import Filter

from configs import dify_config
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset


class TencentConfig(BaseModel):
    url: str
    api_key: Optional[str]
    timeout: float = 30
    username: Optional[str]
    database: Optional[str]
    index_type: str = "HNSW"
    metric_type: str = "L2"
    shard: int = (1,)
    replicas: int = (2,)

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
        self._client = VectorDBClient(**self._client_config.to_tencent_params())
        self._db = self._init_database()

    def _init_database(self):
        exists = False
        for db in self._client.list_databases():
            if db.database_name == self._client_config.database:
                exists = True
                break
        if exists:
            return self._client.database(self._client_config.database)
        else:
            return self._client.create_database(database_name=self._client_config.database)

    def get_type(self) -> str:
        return VectorType.TENCENT

    def to_index_struct(self) -> dict:
        return {"type": self.get_type(), "vector_store": {"class_prefix": self._collection_name}}

    def _has_collection(self) -> bool:
        collections = self._db.list_collections()
        return any(collection.collection_name == self._collection_name for collection in collections)

    def _create_collection(self, dimension: int) -> None:
        lock_name = "vector_indexing_lock_{}".format(self._collection_name)
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = "vector_indexing_{}".format(self._collection_name)
            if redis_client.get(collection_exist_cache_key):
                return

            if self._has_collection():
                return

            self.delete()
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
            index = vdb_index.Index(
                vdb_index.FilterIndex(self.field_id, enum.FieldType.String, enum.IndexType.PRIMARY_KEY),
                vdb_index.VectorIndex(
                    self.field_vector,
                    dimension,
                    index_type,
                    metric_type,
                    params,
                ),
                vdb_index.FilterIndex(self.field_text, enum.FieldType.String, enum.IndexType.FILTER),
                vdb_index.FilterIndex(self.field_metadata, enum.FieldType.String, enum.IndexType.FILTER),
            )

            self._db.create_collection(
                name=self._collection_name,
                shard=self._client_config.shard,
                replicas=self._client_config.replicas,
                description="Collection for Dify",
                index=index,
            )
            redis_client.set(collection_exist_cache_key, 1, ex=3600)

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        self._create_collection(len(embeddings[0]))
        self.add_texts(texts, embeddings)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        texts = [doc.page_content for doc in documents]
        metadatas = [doc.metadata for doc in documents]
        total_count = len(embeddings)
        docs = []
        for id in range(0, total_count):
            if metadatas is None:
                continue
            metadata = json.dumps(metadatas[id])
            doc = document.Document(
                id=metadatas[id]["doc_id"],
                vector=embeddings[id],
                text=texts[id],
                metadata=metadata,
            )
            docs.append(doc)
        self._db.collection(self._collection_name).upsert(docs, self._client_config.timeout)

    def text_exists(self, id: str) -> bool:
        docs = self._db.collection(self._collection_name).query(document_ids=[id])
        if docs and len(docs) > 0:
            return True
        return False

    def delete_by_ids(self, ids: list[str]) -> None:
        self._db.collection(self._collection_name).delete(document_ids=ids)

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        self._db.collection(self._collection_name).delete(filter=Filter(Filter.In(key, [value])))

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        res = self._db.collection(self._collection_name).search(
            vectors=[query_vector],
            params=document.HNSWSearchParams(ef=kwargs.get("ef", 10)),
            retrieve_vector=False,
            limit=kwargs.get("top_k", 4),
            timeout=self._client_config.timeout,
        )
        score_threshold = float(kwargs.get("score_threshold") or 0.0)
        return self._get_search_res(res, score_threshold)

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        return []

    def _get_search_res(self, res, score_threshold):
        docs = []
        if res is None or len(res) == 0:
            return docs

        for result in res[0]:
            meta = result.get(self.field_metadata)
            if meta is not None:
                meta = json.loads(meta)
            score = 1 - result.get("score", 0.0)
            if score > score_threshold:
                meta["score"] = score
                doc = Document(page_content=result.get(self.field_text), metadata=meta)
                docs.append(doc)

        return docs

    def delete(self) -> None:
        self._db.drop_collection(name=self._collection_name)


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
                url=dify_config.TENCENT_VECTOR_DB_URL,
                api_key=dify_config.TENCENT_VECTOR_DB_API_KEY,
                timeout=dify_config.TENCENT_VECTOR_DB_TIMEOUT,
                username=dify_config.TENCENT_VECTOR_DB_USERNAME,
                database=dify_config.TENCENT_VECTOR_DB_DATABASE,
                shard=dify_config.TENCENT_VECTOR_DB_SHARD,
                replicas=dify_config.TENCENT_VECTOR_DB_REPLICAS,
            ),
        )
