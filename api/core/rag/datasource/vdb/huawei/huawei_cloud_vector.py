import json
import logging
import ssl
from typing import Any

from elasticsearch import Elasticsearch
from pydantic import BaseModel, model_validator

from configs import dify_config
from core.rag.datasource.vdb.field import Field
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)


def create_ssl_context() -> ssl.SSLContext:
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    return ssl_context


class HuaweiCloudVectorConfig(BaseModel):
    hosts: str
    username: str | None = None
    password: str | None = None

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict):
        if not values["hosts"]:
            raise ValueError("config HOSTS is required")
        return values

    def to_elasticsearch_params(self) -> dict[str, Any]:
        params = {
            "hosts": self.hosts.split(","),
            "verify_certs": False,
            "ssl_show_warn": False,
            "request_timeout": 30000,
            "retry_on_timeout": True,
            "max_retries": 10,
        }
        if self.username and self.password:
            params["basic_auth"] = (self.username, self.password)
        return params


class HuaweiCloudVector(BaseVector):
    def __init__(self, index_name: str, config: HuaweiCloudVectorConfig):
        super().__init__(index_name.lower())
        self._client = Elasticsearch(**config.to_elasticsearch_params())

    def get_type(self) -> str:
        return VectorType.HUAWEI_CLOUD

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        uuids = self._get_uuids(documents)
        for i in range(len(documents)):
            self._client.index(
                index=self._collection_name,
                id=uuids[i],
                document={
                    Field.CONTENT_KEY: documents[i].page_content,
                    Field.VECTOR: embeddings[i] or None,
                    Field.METADATA_KEY: documents[i].metadata or {},
                },
            )
        self._client.indices.refresh(index=self._collection_name)
        return uuids

    def text_exists(self, id: str) -> bool:
        return bool(self._client.exists(index=self._collection_name, id=id))

    def delete_by_ids(self, ids: list[str]):
        if not ids:
            return
        for id in ids:
            self._client.delete(index=self._collection_name, id=id)

    def delete_by_metadata_field(self, key: str, value: str):
        query_str = {"query": {"match": {f"metadata.{key}": f"{value}"}}}
        results = self._client.search(index=self._collection_name, body=query_str)
        ids = [hit["_id"] for hit in results["hits"]["hits"]]
        if ids:
            self.delete_by_ids(ids)

    def delete(self):
        self._client.indices.delete(index=self._collection_name)

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 4)

        query = {
            "size": top_k,
            "query": {
                "vector": {
                    Field.VECTOR: {
                        "vector": query_vector,
                        "topk": top_k,
                    }
                }
            },
        }

        results = self._client.search(index=self._collection_name, body=query)

        docs_and_scores = []
        for hit in results["hits"]["hits"]:
            docs_and_scores.append(
                (
                    Document(
                        page_content=hit["_source"][Field.CONTENT_KEY],
                        vector=hit["_source"][Field.VECTOR],
                        metadata=hit["_source"][Field.METADATA_KEY],
                    ),
                    hit["_score"],
                )
            )

        docs = []
        for doc, score in docs_and_scores:
            score_threshold = float(kwargs.get("score_threshold") or 0.0)
            if score >= score_threshold:
                if doc.metadata is not None:
                    doc.metadata["score"] = score
            docs.append(doc)

        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        query_str = {"match": {Field.CONTENT_KEY: query}}
        results = self._client.search(index=self._collection_name, query=query_str, size=kwargs.get("top_k", 4))
        docs = []
        for hit in results["hits"]["hits"]:
            docs.append(
                Document(
                    page_content=hit["_source"][Field.CONTENT_KEY],
                    vector=hit["_source"][Field.VECTOR],
                    metadata=hit["_source"][Field.METADATA_KEY],
                )
            )

        return docs

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        metadatas = [d.metadata if d.metadata is not None else {} for d in texts]
        self.create_collection(embeddings, metadatas)
        self.add_texts(texts, embeddings, **kwargs)

    def create_collection(
        self,
        embeddings: list[list[float]],
        metadatas: list[dict[Any, Any]] | None = None,
        index_params: dict | None = None,
    ):
        lock_name = f"vector_indexing_lock_{self._collection_name}"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                logger.info("Collection %s already exists.", self._collection_name)
                return

            if not self._client.indices.exists(index=self._collection_name):
                dim = len(embeddings[0])
                mappings = {
                    "properties": {
                        Field.CONTENT_KEY: {"type": "text"},
                        Field.VECTOR: {  # Make sure the dimension is correct here
                            "type": "vector",
                            "dimension": dim,
                            "indexing": True,
                            "algorithm": "GRAPH",
                            "metric": "cosine",
                            "neighbors": 32,
                            "efc": 128,
                        },
                        Field.METADATA_KEY: {
                            "type": "object",
                            "properties": {
                                "doc_id": {"type": "keyword"}  # Map doc_id to keyword type
                            },
                        },
                    }
                }
                settings = {"index.vector": True}
                self._client.indices.create(index=self._collection_name, mappings=mappings, settings=settings)

            redis_client.set(collection_exist_cache_key, 1, ex=3600)


class HuaweiCloudVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> HuaweiCloudVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix.lower()
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id).lower()
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.HUAWEI_CLOUD, collection_name))

        return HuaweiCloudVector(
            index_name=collection_name,
            config=HuaweiCloudVectorConfig(
                hosts=dify_config.HUAWEI_CLOUD_HOSTS or "http://localhost:9200",
                username=dify_config.HUAWEI_CLOUD_USER,
                password=dify_config.HUAWEI_CLOUD_PASSWORD,
            ),
        )
