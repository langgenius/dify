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
        self._dataset = dataset
        self._client_config = config
        self._embeddings = embeddings
        self._vector_store = None

    def get_type(self) -> str:
        return 'qdrant'

    def get_index_name(self, dataset: Dataset) -> str:
        if self._dataset.index_struct_dict:
            return self._dataset.index_struct_dict['vector_store']['collection_name']

        dataset_id = dataset.id
        return "Vector_index_" + dataset_id.replace("-", "_")

    def to_index_struct(self) -> dict:
        return {
            "type": self.get_type(),
            "vector_store": {"collection_name": self.get_index_name(self._dataset)}
        }

    def create(self, texts: list[Document], **kwargs) -> BaseIndex:
        uuids = self._get_uuids(texts)
        self._vector_store = QdrantVectorStore.from_documents(
            texts,
            self._embeddings,
            collection_name=self.get_index_name(self._dataset),
            ids=uuids,
            **self._client_config.to_qdrant_params()
        )

        return self

    def _get_vector_store(self) -> VectorStore:
        """Only for created index."""
        if self._vector_store:
            return self._vector_store
        
        client = qdrant_client.QdrantClient(
            **self._client_config.to_qdrant_params()
        )

        return QdrantVectorStore(
            client=client,
            collection_name=self.get_index_name(self._dataset),
            embeddings=self._embeddings
        )

    def _get_vector_store_class(self) -> type:
        return QdrantVectorStore

    def delete_by_document_id(self, document_id: str):
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
