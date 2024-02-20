from typing import Any, cast

from langchain.embeddings.base import Embeddings
from langchain.schema import Document
from langchain.vectorstores import VectorStore
from pydantic import BaseModel, root_validator

from core.index.base import BaseIndex
from core.index.vector_index.base import BaseVectorIndex
from core.vector_store.milvus_vector_store import MilvusVectorStore
from models.dataset import Dataset


class MilvusConfig(BaseModel):
    host: str
    port: int
    user: str
    password: str
    secure: bool = False
    batch_size: int = 100

    @root_validator()
    def validate_config(cls, values: dict) -> dict:
        if not values['host']:
            raise ValueError("config MILVUS_HOST is required")
        if not values['port']:
            raise ValueError("config MILVUS_PORT is required")
        if not values['user']:
            raise ValueError("config MILVUS_USER is required")
        if not values['password']:
            raise ValueError("config MILVUS_PASSWORD is required")
        return values

    def to_milvus_params(self):
        return {
            'host': self.host,
            'port': self.port,
            'user': self.user,
            'password': self.password,
            'secure': self.secure
        }


class MilvusVectorIndex(BaseVectorIndex):
    def __init__(self, dataset: Dataset, config: MilvusConfig, embeddings: Embeddings):
        super().__init__(dataset, embeddings)
        self._client_config = config

    def get_type(self) -> str:
        return 'milvus'

    def get_index_name(self, dataset: Dataset) -> str:
        if self.dataset.index_struct_dict:
            class_prefix: str = self.dataset.index_struct_dict['vector_store']['class_prefix']
            if not class_prefix.endswith('_Node'):
                # original class_prefix
                class_prefix += '_Node'

            return class_prefix

        dataset_id = dataset.id
        return "Vector_index_" + dataset_id.replace("-", "_") + '_Node'

    def to_index_struct(self) -> dict:
        return {
            "type": self.get_type(),
            "vector_store": {"class_prefix": self.get_index_name(self.dataset)}
        }

    def create(self, texts: list[Document], **kwargs) -> BaseIndex:
        uuids = self._get_uuids(texts)
        index_params = {
            'metric_type': 'IP',
            'index_type': "HNSW",
            'params': {"M": 8, "efConstruction": 64}
        }
        self._vector_store = MilvusVectorStore.from_documents(
            texts,
            self._embeddings,
            collection_name=self.get_index_name(self.dataset),
            connection_args=self._client_config.to_milvus_params(),
            index_params=index_params
        )

        return self

    def create_with_collection_name(self, texts: list[Document], collection_name: str, **kwargs) -> BaseIndex:
        uuids = self._get_uuids(texts)
        self._vector_store = MilvusVectorStore.from_documents(
            texts,
            self._embeddings,
            collection_name=collection_name,
            ids=uuids,
            content_payload_key='page_content'
        )

        return self

    def _get_vector_store(self) -> VectorStore:
        """Only for created index."""
        if self._vector_store:
            return self._vector_store

        return MilvusVectorStore(
            collection_name=self.get_index_name(self.dataset),
            embedding_function=self._embeddings,
            connection_args=self._client_config.to_milvus_params()
        )

    def _get_vector_store_class(self) -> type:
        return MilvusVectorStore

    def delete_by_document_id(self, document_id: str):

        vector_store = self._get_vector_store()
        vector_store = cast(self._get_vector_store_class(), vector_store)
        ids = vector_store.get_ids_by_document_id(document_id)
        if ids:
            vector_store.del_texts({
                'filter': f'id in {ids}'
            })

    def delete_by_metadata_field(self, key: str, value: str):

        vector_store = self._get_vector_store()
        vector_store = cast(self._get_vector_store_class(), vector_store)
        ids = vector_store.get_ids_by_metadata_field(key, value)
        if ids:
            vector_store.del_texts({
                'filter': f'id in {ids}'
            })

    def delete_by_ids(self, doc_ids: list[str]) -> None:

        vector_store = self._get_vector_store()
        vector_store = cast(self._get_vector_store_class(), vector_store)
        ids = vector_store.get_ids_by_doc_ids(doc_ids)
        vector_store.del_texts({
            'filter': f' id in {ids}'
        })

    def delete_by_group_id(self, group_id: str) -> None:

        vector_store = self._get_vector_store()
        vector_store = cast(self._get_vector_store_class(), vector_store)

        vector_store.delete()

    def delete(self) -> None:
        vector_store = self._get_vector_store()
        vector_store = cast(self._get_vector_store_class(), vector_store)

        from qdrant_client.http import models
        vector_store.del_texts(models.Filter(
            must=[
                models.FieldCondition(
                    key="group_id",
                    match=models.MatchValue(value=self.dataset.id),
                ),
            ],
        ))

    def search_by_full_text_index(self, query: str, **kwargs: Any) -> list[Document]:
        # milvus/zilliz doesn't support bm25 search
        return []
