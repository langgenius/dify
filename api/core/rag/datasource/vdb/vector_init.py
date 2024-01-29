from typing import cast

from core.embedding.cached_embedding import CacheEmbedding
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.rag.datasource.entity.embedding import Embeddings
from core.rag.datasource.vdb.vector_base import BaseVector
from flask import current_app
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
        config = cast(dict, current_app.config)
        vector_type = config.get('VECTOR_STORE')

        if self._dataset.index_struct_dict:
            vector_type = self._dataset.index_struct_dict['type']

        if not vector_type:
            raise ValueError(f"Vector store must be specified.")

        if vector_type == "weaviate":
            from core.rag.datasource.vdb.qdrant.qdrant_vector import WeaviateConfig, WeaviateVector

            return WeaviateVector(
                dataset=self._dataset,
                config=WeaviateConfig(
                    endpoint=config.get('WEAVIATE_ENDPOINT'),
                    api_key=config.get('WEAVIATE_API_KEY'),
                    batch_size=int(config.get('WEAVIATE_BATCH_SIZE'))
                ),
                embeddings=self._embeddings,
                attributes=self._attributes
            )
        elif vector_type == "qdrant":
            from core.rag.datasource.vdb.qdrant.qdrant_vector import QdrantConfig, QdrantVector

            return QdrantVector(
                dataset=self._dataset,
                config=QdrantConfig(
                    endpoint=config.get('QDRANT_URL'),
                    api_key=config.get('QDRANT_API_KEY'),
                    root_path=current_app.root_path,
                    timeout=config.get('QDRANT_CLIENT_TIMEOUT')
                ),
                embeddings=self._embeddings
            )
        elif vector_type == "milvus":
            from core.rag.datasource.vdb.qdrant.qdrant_vector import MilvusConfig, MilvusVector

            return MilvusVector(
                dataset=self._dataset,
                config=MilvusConfig(
                    host=config.get('MILVUS_HOST'),
                    port=config.get('MILVUS_PORT'),
                    user=config.get('MILVUS_USER'),
                    password=config.get('MILVUS_PASSWORD'),
                    secure=config.get('MILVUS_SECURE'),
                ),
                embeddings=self._embeddings
            )
        else:
            raise ValueError(f"Vector store {config.get('VECTOR_STORE')} is not supported.")

    def ceate_index(self):
        self._vector_processor.create()
    def _get_embeddings(self) -> Embeddings:
        model_manager = ModelManager()

        embedding_model = model_manager.get_model_instance(
            tenant_id=self._dataset.tenant_id,
            provider=self._dataset.embedding_model_provider,
            model_type=ModelType.TEXT_EMBEDDING,
            model=self._dataset.embedding_model

        )
        return CacheEmbedding(embedding_model)

    def __getattr__(self, name):
        if self._vector_processor is not None:
            method = getattr(self._vector_processor, name)
            if callable(method):
                return method

        raise AttributeError(f"'vector_processor' object has no attribute '{name}'")

    @property
    def vector_processor(self):
        return self._vector_processor
