from core.rag.datasource.vdb.vector_base import BaseVector
from flask import current_app
from langchain.embeddings.base import Embeddings
from models.dataset import Dataset


class Vector:
    def __init__(self, dataset: Dataset, config: dict, embeddings: Embeddings,
                 attributes: list = None):
        if attributes is None:
            attributes = ['doc_id', 'dataset_id', 'document_id', 'doc_hash']
        self._dataset = dataset
        self._embeddings = embeddings
        self._vector = self._init_vector(dataset, config, embeddings, attributes)
        self._attributes = attributes

    def _init_vector(self, dataset: Dataset, config: dict, embeddings: Embeddings,
                           attributes: list) -> BaseVector:
        vector_type = config.get('VECTOR_STORE')

        if self._dataset.index_struct_dict:
            vector_type = self._dataset.index_struct_dict['type']

        if not vector_type:
            raise ValueError(f"Vector store must be specified.")

        if vector_type == "weaviate":
            from core.rag.datasource.vdb.qdrant.qdrant_vector import WeaviateConfig, WeaviateVector

            return WeaviateVector(
                dataset=dataset,
                config=WeaviateConfig(
                    endpoint=config.get('WEAVIATE_ENDPOINT'),
                    api_key=config.get('WEAVIATE_API_KEY'),
                    batch_size=int(config.get('WEAVIATE_BATCH_SIZE'))
                ),
                embeddings=embeddings,
                attributes=attributes
            )
        elif vector_type == "qdrant":
            from core.rag.datasource.vdb.qdrant.qdrant_vector import QdrantConfig, QdrantVector

            return QdrantVector(
                dataset=dataset,
                config=QdrantConfig(
                    endpoint=config.get('QDRANT_URL'),
                    api_key=config.get('QDRANT_API_KEY'),
                    root_path=current_app.root_path,
                    timeout=config.get('QDRANT_CLIENT_TIMEOUT')
                ),
                embeddings=embeddings
            )
        elif vector_type == "milvus":
            from core.rag.datasource.vdb.qdrant.qdrant_vector import MilvusConfig, MilvusVector

            return MilvusVector(
                dataset=dataset,
                config=MilvusConfig(
                    host=config.get('MILVUS_HOST'),
                    port=config.get('MILVUS_PORT'),
                    user=config.get('MILVUS_USER'),
                    password=config.get('MILVUS_PASSWORD'),
                    secure=config.get('MILVUS_SECURE'),
                ),
                embeddings=embeddings
            )
        else:
            raise ValueError(f"Vector store {config.get('VECTOR_STORE')} is not supported.")

    def __getattr__(self, name):
        if self._vector_index is not None:
            method = getattr(self._vector_index, name)
            if callable(method):
                return method

        raise AttributeError(f"'VectorIndex' object has no attribute '{name}'")

    @property
    def vector(self):
        return self._vector

