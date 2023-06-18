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

    def get_index_name(self, dataset_id: str) -> str:
        return "Vector_index_" + dataset_id.replace("-", "_") + '_Node'

    def to_index_struct(self) -> dict:
        return {
            "type": self.get_type(),
            "vector_store": {"collection_name": self.get_index_name(self._dataset.get_id())}
        }

    def create(self, texts: list[Document]) -> BaseIndex:
        uuids = self._get_uuids(texts)
        self._vector_store = QdrantVectorStore.from_documents(
            texts,
            self._embeddings,
            collection_name=self.get_index_name(self._dataset.get_id()),
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
            collection_name=self.get_index_name(self._dataset.get_id()),
            embeddings=self._embeddings
        )

    def get_retriever(self, **kwargs: Any) -> BaseRetriever:
        vector_store = self._get_vector_store()
        vector_store = cast(QdrantVectorStore, vector_store)

        return vector_store.as_retriever(**kwargs)

    def search(
            self, query: str,
            **kwargs: Any
    ) -> List[Document]:
        vector_store = self._get_vector_store()
        vector_store = cast(QdrantVectorStore, vector_store)

        search_type = kwargs.get('search_type') if kwargs.get('search_type') else 'similarity'
        search_kwargs = kwargs.get('search_kwargs') if kwargs.get('search_kwargs') else {}

        # similarity k
        # mmr k, fetch_k, lambda_mult
        # similarity_score_threshold k
        return vector_store.as_retriever(
            search_type=search_type,
            search_kwargs=search_kwargs
        ).get_relevant_documents(query)

    def add_texts(self, texts: list[Document]):
        vector_store = self._get_vector_store()
        vector_store = cast(QdrantVectorStore, vector_store)

        texts = self._filter_duplicate_texts(texts)
        uuids = self._get_uuids(texts)
        vector_store.add_documents(texts, uuids=uuids)

    def text_exists(self, id: str) -> bool:
        vector_store = self._get_vector_store()
        vector_store = cast(QdrantVectorStore, vector_store)

        return vector_store.text_exists(id)

    def delete_by_ids(self, ids: list[str]) -> None:
        vector_store = self._get_vector_store()
        vector_store = cast(QdrantVectorStore, vector_store)

        for node_id in ids:
            vector_store.del_text(node_id)

    def delete_by_document_id(self, document_id: str):
        vector_store = self._get_vector_store()
        vector_store = cast(QdrantVectorStore, vector_store)

        from qdrant_client.http import models

        vector_store.del_texts(models.Filter(
            must=[
                models.FieldCondition(
                    key="metadata.document_id",
                    match=models.MatchValue(value=document_id),
                ),
            ],
        ))
