from typing import Any, Optional, cast

import requests
import weaviate
from langchain.embeddings.base import Embeddings
from langchain.schema import Document
from langchain.vectorstores import VectorStore
from pydantic import BaseModel, root_validator

from core.index.base import BaseIndex
from core.index.vector_index.base import BaseVectorIndex
from core.vector_store.weaviate_vector_store import WeaviateVectorStore
from models.dataset import Dataset


class WeaviateConfig(BaseModel):
    endpoint: str
    api_key: Optional[str]
    batch_size: int = 100

    @root_validator()
    def validate_config(cls, values: dict) -> dict:
        if not values['endpoint']:
            raise ValueError("config WEAVIATE_ENDPOINT is required")
        return values


class WeaviateVectorIndex(BaseVectorIndex):

    def __init__(self, dataset: Dataset, config: WeaviateConfig, embeddings: Embeddings, attributes: list):
        super().__init__(dataset, embeddings)
        self._client = self._init_client(config)
        self._attributes = attributes

    def _init_client(self, config: WeaviateConfig) -> weaviate.Client:
        auth_config = weaviate.auth.AuthApiKey(api_key=config.api_key)

        weaviate.connect.connection.has_grpc = False

        try:
            client = weaviate.Client(
                url=config.endpoint,
                auth_client_secret=auth_config,
                timeout_config=(5, 60),
                startup_period=None
            )
        except requests.exceptions.ConnectionError:
            raise ConnectionError("Vector database connection error")

        client.batch.configure(
            # `batch_size` takes an `int` value to enable auto-batching
            # (`None` is used for manual batching)
            batch_size=config.batch_size,
            # dynamically update the `batch_size` based on import speed
            dynamic=True,
            # `timeout_retries` takes an `int` value to retry on time outs
            timeout_retries=3,
        )

        return client

    def get_type(self) -> str:
        return 'weaviate'

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
        self._vector_store = WeaviateVectorStore.from_documents(
            texts,
            self._embeddings,
            client=self._client,
            index_name=self.get_index_name(self.dataset),
            uuids=uuids,
            by_text=False
        )

        return self

    def create_with_collection_name(self, texts: list[Document], collection_name: str, **kwargs) -> BaseIndex:
        uuids = self._get_uuids(texts)
        self._vector_store = WeaviateVectorStore.from_documents(
            texts,
            self._embeddings,
            client=self._client,
            index_name=self.get_index_name(self.dataset),
            uuids=uuids,
            by_text=False
        )

        return self


    def _get_vector_store(self) -> VectorStore:
        """Only for created index."""
        if self._vector_store:
            return self._vector_store

        attributes = self._attributes
        if self._is_origin():
            attributes = ['doc_id']

        return WeaviateVectorStore(
            client=self._client,
            index_name=self.get_index_name(self.dataset),
            text_key='text',
            embedding=self._embeddings,
            attributes=attributes,
            by_text=False
        )

    def _get_vector_store_class(self) -> type:
        return WeaviateVectorStore

    def delete_by_document_id(self, document_id: str):
        if self._is_origin():
            self.recreate_dataset(self.dataset)
            return

        vector_store = self._get_vector_store()
        vector_store = cast(self._get_vector_store_class(), vector_store)

        vector_store.del_texts({
            "operator": "Equal",
            "path": ["document_id"],
            "valueText": document_id
        })

    def delete_by_metadata_field(self, key: str, value: str):

        vector_store = self._get_vector_store()
        vector_store = cast(self._get_vector_store_class(), vector_store)

        vector_store.del_texts({
            "operator": "Equal",
            "path": [key],
            "valueText": value
        })

    def delete_by_group_id(self, group_id: str):
        if self._is_origin():
            self.recreate_dataset(self.dataset)
            return

        vector_store = self._get_vector_store()
        vector_store = cast(self._get_vector_store_class(), vector_store)

        vector_store.delete()

    def _is_origin(self):
        if self.dataset.index_struct_dict:
            class_prefix: str = self.dataset.index_struct_dict['vector_store']['class_prefix']
            if not class_prefix.endswith('_Node'):
                # original class_prefix
                return True

        return False

    def search_by_full_text_index(self, query: str, **kwargs: Any) -> list[Document]:
        vector_store = self._get_vector_store()
        vector_store = cast(self._get_vector_store_class(), vector_store)
        return vector_store.similarity_search_by_bm25(query, kwargs.get('top_k', 2), **kwargs)

