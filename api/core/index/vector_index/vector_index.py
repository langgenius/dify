import json

from flask import current_app
from langchain.embeddings.base import Embeddings

from core.index.vector_index.base import BaseVectorIndex
from extensions.ext_database import db
from models.dataset import Dataset, Document


class VectorIndex:
    def __init__(self, dataset: Dataset, config: dict, embeddings: Embeddings):
        self._dataset = dataset
        self._embeddings = embeddings
        self._vector_index = self._init_vector_index(dataset, config, embeddings)

    def _init_vector_index(self, dataset: Dataset, config: dict, embeddings: Embeddings) -> BaseVectorIndex:
        vector_type = config.get('VECTOR_STORE')

        if self._dataset.index_struct_dict:
            vector_type = self._dataset.index_struct_dict['type']

        if not vector_type:
            raise ValueError(f"Vector store must be specified.")

        if vector_type == "weaviate":
            from core.index.vector_index.weaviate_vector_index import WeaviateVectorIndex, WeaviateConfig

            return WeaviateVectorIndex(
                dataset=dataset,
                config=WeaviateConfig(
                    endpoint=config.get('WEAVIATE_ENDPOINT'),
                    api_key=config.get('WEAVIATE_API_KEY'),
                    batch_size=int(config.get('WEAVIATE_BATCH_SIZE'))
                ),
                embeddings=embeddings
            )
        elif vector_type == "qdrant":
            from core.index.vector_index.qdrant_vector_index import QdrantVectorIndex, QdrantConfig

            return QdrantVectorIndex(
                dataset=dataset,
                config=QdrantConfig(
                    endpoint=config.get('QDRANT_URL'),
                    api_key=config.get('QDRANT_API_KEY'),
                    root_path=current_app.root_path
                ),
                embeddings=embeddings
            )
        else:
            raise ValueError(f"Vector store {config.get('VECTOR_STORE')} is not supported.")

    def add_texts(self, texts: list[Document], **kwargs):
        if not self._dataset.index_struct_dict:
            self._vector_index.create(texts, **kwargs)
            self._dataset.index_struct = json.dumps(self._vector_index.to_index_struct())
            db.session.commit()
            return

        self._vector_index.add_texts(texts, **kwargs)

    def __getattr__(self, name):
        if self._vector_index is not None:
            method = getattr(self._vector_index, name)
            if callable(method):
                return method

        raise AttributeError(f"'VectorIndex' object has no attribute '{name}'")

