import os
from typing import Any, Optional, cast

import qdrant_client
from langchain.embeddings.base import Embeddings
from langchain.schema import Document
from langchain.vectorstores import VectorStore
from pydantic import BaseModel
from qdrant_client.http.models import HnswConfigDiff

from core.index.base import BaseIndex
from core.index.vector_index.base import BaseVectorIndex
from core.vector_store.qdrant_vector_store import QdrantVectorStore
from extensions.ext_database import db
from models.dataset import Dataset, DatasetCollectionBinding


class QdrantConfig(BaseModel):
    endpoint: str
    api_key: Optional[str]
    timeout: float = 20
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
                'timeout': self.timeout
            }


class QdrantVectorIndex(BaseVectorIndex):
    def __init__(self, dataset: Dataset, config: QdrantConfig, embeddings: Embeddings):
        super().__init__(dataset, embeddings)
        self._client_config = config

    def get_type(self) -> str:
        return 'qdrant'

    def get_index_name(self, dataset: Dataset) -> str:
        if dataset.collection_binding_id:
            dataset_collection_binding = db.session.query(DatasetCollectionBinding). \
                filter(DatasetCollectionBinding.id == dataset.collection_binding_id). \
                one_or_none()
            if dataset_collection_binding:
                return dataset_collection_binding.collection_name
            else:
                raise ValueError('Dataset Collection Bindings is not exist!')
        else:
            if self.dataset.index_struct_dict:
                class_prefix: str = self.dataset.index_struct_dict['vector_store']['class_prefix']
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
            group_id=self.dataset.id,
            group_payload_key='group_id',
            hnsw_config=HnswConfigDiff(m=0, payload_m=16, ef_construct=100, full_scan_threshold=10000,
                                       max_indexing_threads=0, on_disk=False),
            **self._client_config.to_qdrant_params()
        )

        return self

    def create_with_collection_name(self, texts: list[Document], collection_name: str, **kwargs) -> BaseIndex:
        uuids = self._get_uuids(texts)
        self._vector_store = QdrantVectorStore.from_documents(
            texts,
            self._embeddings,
            collection_name=collection_name,
            ids=uuids,
            content_payload_key='page_content',
            group_id=self.dataset.id,
            group_payload_key='group_id',
            hnsw_config=HnswConfigDiff(m=0, payload_m=16, ef_construct=100, full_scan_threshold=10000,
                                       max_indexing_threads=0, on_disk=False),
            **self._client_config.to_qdrant_params()
        )

        return self

    def _get_vector_store(self) -> VectorStore:
        """Only for created index."""
        if self._vector_store:
            return self._vector_store
        attributes = ['doc_id', 'dataset_id', 'document_id']
        client = qdrant_client.QdrantClient(
            **self._client_config.to_qdrant_params()
        )

        return QdrantVectorStore(
            client=client,
            collection_name=self.get_index_name(self.dataset),
            embeddings=self._embeddings,
            content_payload_key='page_content',
            group_id=self.dataset.id,
            group_payload_key='group_id'
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

    def delete_by_metadata_field(self, key: str, value: str):

        vector_store = self._get_vector_store()
        vector_store = cast(self._get_vector_store_class(), vector_store)

        from qdrant_client.http import models

        vector_store.del_texts(models.Filter(
            must=[
                models.FieldCondition(
                    key=f"metadata.{key}",
                    match=models.MatchValue(value=value),
                ),
            ],
        ))

    def delete_by_ids(self, ids: list[str]) -> None:

        vector_store = self._get_vector_store()
        vector_store = cast(self._get_vector_store_class(), vector_store)

        from qdrant_client.http import models
        for node_id in ids:
            vector_store.del_texts(models.Filter(
                must=[
                    models.FieldCondition(
                        key="metadata.doc_id",
                        match=models.MatchValue(value=node_id),
                    ),
                ],
            ))

    def delete_by_group_id(self, group_id: str) -> None:

        vector_store = self._get_vector_store()
        vector_store = cast(self._get_vector_store_class(), vector_store)

        from qdrant_client.http import models
        vector_store.del_texts(models.Filter(
            must=[
                models.FieldCondition(
                    key="group_id",
                    match=models.MatchValue(value=group_id),
                ),
            ],
        ))

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

        from qdrant_client.http import models
        return vector_store.similarity_search_by_bm25(models.Filter(
            must=[
                models.FieldCondition(
                    key="group_id",
                    match=models.MatchValue(value=self.dataset.id),
                ),
                models.FieldCondition(
                    key="page_content",
                    match=models.MatchText(text=query),
                )
            ],
        ), kwargs.get('top_k', 2))
