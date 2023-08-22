import os
from typing import Optional, Any, List, cast

import qdrant_client
from langchain.embeddings.base import Embeddings
from langchain.schema import Document, BaseRetriever
from langchain.vectorstores import VectorStore
from pydantic import BaseModel

from core.index.base import BaseIndex
from core.index.vector_index.base import BaseVectorIndex
from core.vector_store.qdrant_vector_store import QdrantVectorStore
from models.dataset import Dataset


class QdrantConfig(BaseModel):
    endpoint: str
    api_key: Optional[str]
    root_path: Optional[str]
    
    def to_qdrant_params(self):
        if self.endpoint and self.endpoint.startswith('path:'):
            path = self.endpoint.replace('path:', '')
            if not os.path.isabs(path):
                path = os.path.join(self.root_path, path)

            return {
                'path': path
            }
        else:
            return {
                'url': self.endpoint,
                'api_key': self.api_key,
            }


class QdrantVectorIndex(BaseVectorIndex):
    def __init__(self, dataset: Dataset, config: QdrantConfig, embeddings: Embeddings):
        super().__init__(dataset, embeddings)
        self._client_config = config

    def get_type(self) -> str:
        return 'qdrant'

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
        self._vector_store = QdrantVectorStore.from_documents(
            texts,
            self._embeddings,
            collection_name=self.get_index_name(self.dataset),
            ids=uuids,
            content_payload_key='page_content',
            **self._client_config.to_qdrant_params()
        )

        return self

    def _get_vector_store(self) -> VectorStore:
        """Only for created index."""
        if self._vector_store:
            return self._vector_store
        attributes = ['doc_id', 'dataset_id', 'document_id']
        if self._is_origin():
            attributes = ['doc_id']
        client = qdrant_client.QdrantClient(
            **self._client_config.to_qdrant_params()
        )

        return QdrantVectorStore(
            client=client,
            collection_name=self.get_index_name(self.dataset),
            embeddings=self._embeddings,
            content_payload_key='page_content'
        )

    def _get_vector_store_class(self) -> type:
        return QdrantVectorStore

    def delete_by_document_id(self, document_id: str):
        if self._is_origin():
            self.recreate_dataset(self.dataset)
            return

        vector_store = self._get_vector_store()
        vector_store = cast(self._get_vector_store_class(), vector_store)

        from qdrant_client.http import models

        vector_store.del_texts(models.Filter(
            must=[
                models.FieldCondition(
                    key="metadata.document_id",
                    match=models.MatchValue(value=document_id),
                ),
            ],
        ))

    def _is_origin(self):
        if self.dataset.index_struct_dict:
            class_prefix: str = self.dataset.index_struct_dict['vector_store']['class_prefix']
            if not class_prefix.endswith('_Node'):
                # original class_prefix
                return True

        return False
