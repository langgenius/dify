from abc import ABC, abstractmethod
from typing import Any

from flask import current_app

from core.embedding.cached_embedding import CacheEmbedding
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.rag.datasource.entity.embedding import Embeddings
from core.rag.datasource.vdb.milvus.milvus_vector import MilvusVectorFactory
from core.rag.datasource.vdb.pgvecto_rs.pgvecto_rs import PGVectoRSFactory
from core.rag.datasource.vdb.pgvector.pgvector import PGVectorFactory
from core.rag.datasource.vdb.qdrant.qdrant_vector import QdrantVectorFactory
from core.rag.datasource.vdb.relyt.relyt_vector import RelytVectorFactory
from core.rag.datasource.vdb.tidb_vector.tidb_vector import TiDBVectorFactory
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.datasource.vdb.weaviate.weaviate_vector import WeaviateVectorFactory
from core.rag.models.document import Document
from models.dataset import Dataset


class Vector:
    def __init__(self, dataset: Dataset, attributes: list = None):
        if attributes is None:
            attributes = ['doc_id', 'dataset_id', 'document_id', 'doc_hash']
        self._dataset = dataset
        self._embeddings = self._get_embeddings()
        self._attributes = attributes
        self._vector_processor = self._init_vector()

    def _init_vector(self) -> BaseVector:
        config = current_app.config
        vector_type = config.get('VECTOR_STORE')

        if self._dataset.index_struct_dict:
            vector_type = self._dataset.index_struct_dict['type']

        if not vector_type:
            raise ValueError("Vector store must be specified.")

        vector_factories_map: dict[str, type[AbstractVectorFactory]] = {
            VectorType.MILVUS: MilvusVectorFactory,
            VectorType.PGVECTOR: PGVectorFactory,
            VectorType.PGVECTO_RS: PGVectoRSFactory,
            VectorType.QDRANT: QdrantVectorFactory,
            VectorType.RELYT: RelytVectorFactory,
            VectorType.TIDB_VECTOR: TiDBVectorFactory,
            VectorType.WEAVIATE: WeaviateVectorFactory,
        }

        vector_factory = vector_factories_map.get(vector_type)
        if vector_factory is None:
            raise ValueError(f"Vector store {vector_type} is not supported.")

        return vector_factory.create_vector(self._dataset, self._attributes, self._embeddings)

    def create(self, texts: list = None, **kwargs):
        if texts:
            embeddings = self._embeddings.embed_documents([document.page_content for document in texts])
            self._vector_processor.create(
                texts=texts,
                embeddings=embeddings,
                **kwargs
            )

    def add_texts(self, documents: list[Document], **kwargs):
        if kwargs.get('duplicate_check', False):
            documents = self._filter_duplicate_texts(documents)
        embeddings = self._embeddings.embed_documents([document.page_content for document in documents])
        self._vector_processor.create(
            texts=documents,
            embeddings=embeddings,
            **kwargs
        )

    def text_exists(self, id: str) -> bool:
        return self._vector_processor.text_exists(id)

    def delete_by_ids(self, ids: list[str]) -> None:
        self._vector_processor.delete_by_ids(ids)

    def delete_by_metadata_field(self, key: str, value: str) -> None:
        self._vector_processor.delete_by_metadata_field(key, value)

    def search_by_vector(
            self, query: str,
            **kwargs: Any
    ) -> list[Document]:
        query_vector = self._embeddings.embed_query(query)
        return self._vector_processor.search_by_vector(query_vector, **kwargs)

    def search_by_full_text(
            self, query: str,
            **kwargs: Any
    ) -> list[Document]:
        return self._vector_processor.search_by_full_text(query, **kwargs)

    def delete(self) -> None:
        self._vector_processor.delete()

    def _get_embeddings(self) -> Embeddings:
        model_manager = ModelManager()

        embedding_model = model_manager.get_model_instance(
            tenant_id=self._dataset.tenant_id,
            provider=self._dataset.embedding_model_provider,
            model_type=ModelType.TEXT_EMBEDDING,
            model=self._dataset.embedding_model

        )
        return CacheEmbedding(embedding_model)

    def _filter_duplicate_texts(self, texts: list[Document]) -> list[Document]:
        for text in texts:
            doc_id = text.metadata['doc_id']
            exists_duplicate_node = self.text_exists(doc_id)
            if exists_duplicate_node:
                texts.remove(text)

        return texts

    def __getattr__(self, name):
        if self._vector_processor is not None:
            method = getattr(self._vector_processor, name)
            if callable(method):
                return method

        raise AttributeError(f"'vector_processor' object has no attribute '{name}'")


class AbstractVectorFactory(ABC):
    @abstractmethod
    def create_vector(self, dataset: Dataset, attributes: list = None, embeddings: Embeddings = None) -> BaseVector:
        raise NotImplementedError

    def gen_index_struct_dict(self, vector_type: VectorType, collection_name: str) -> dict:
        index_struct_dict = {
            "type": vector_type,
            "vector_store": {"class_prefix": collection_name}
        }
        return index_struct_dict
